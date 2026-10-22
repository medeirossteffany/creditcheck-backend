import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { verifyToken } from '../middlewares/auth';
import { AmqpConnection, assertTopology, ConsultationResultMessage, QUEUES } from '../messaging/rabbitmq';

export const SOCKET_EVENTS = {
  consultationUpdated: 'consultation:updated',
} as const;

const ADMINS_ROOM = 'admins';

export function createSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, { cors: { origin: env.corsOrigin } });

  // O front conecta com: io(URL, { auth: { token: '<jwt>' } })
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) return next(new Error('Token não informado'));
      socket.data.user = verifyToken(token);
      next();
    } catch {
      next(new Error('Token inválido ou expirado'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { id: number; role: string };
    socket.join(`user:${user.id}`);
    if (user.role === 'ADMIN') socket.join(ADMINS_ROOM);
  });

  return io;
}

/**
 * Consome a fila de resultados publicada pelo Worker e repassa ao front via WebSocket.
 * Todos os admins recebem o evento para atualizar o status na tabela de clientes.
 */
export async function startResultsConsumer(connection: AmqpConnection, io: Server): Promise<void> {
  const channel = await connection.createChannel();
  await assertTopology(channel);
  await channel.prefetch(20);

  await channel.consume(QUEUES.results, (msg) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString()) as ConsultationResultMessage;
      io.to(ADMINS_ROOM).emit(SOCKET_EVENTS.consultationUpdated, payload);
      channel.ack(msg);
    } catch (err) {
      console.error('[realtime] mensagem de resultado inválida, descartando', err);
      channel.nack(msg, false, false);
    }
  });

  console.log(`[realtime] consumindo fila ${QUEUES.results}`);
}
