import { createServer } from 'http';
import { createApp } from './app';
import { assertApiEnv, env } from './config/env';
import { waitForDatabase } from './db/waitForDatabase';
import { pool } from './db/pool';
import { initPublisher } from './messaging/publisher';
import { connectRabbit } from './messaging/rabbitmq';
import { ensureAdminUser } from './modules/users/users.service';
import { createSocketServer, startResultsConsumer } from './realtime/socket';

async function main(): Promise<void> {
  assertApiEnv();

  await waitForDatabase();
  await ensureAdminUser(env.admin);

  const rabbit = await connectRabbit();
  rabbit.on('close', () => {
    console.error('[api] conexão com RabbitMQ perdida, encerrando para reinício');
    process.exit(1);
  });
  await initPublisher(rabbit);

  const httpServer = createServer(createApp());
  const io = createSocketServer(httpServer);
  await startResultsConsumer(rabbit, io);

  httpServer.listen(env.port, () => {
    console.log(`[api] ouvindo na porta ${env.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`[api] ${signal} recebido, encerrando...`);
    io.close();
    httpServer.close();
    rabbit.removeAllListeners('close');
    await rabbit.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[api] falha ao iniciar', err);
  process.exit(1);
});
