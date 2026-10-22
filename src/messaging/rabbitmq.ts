import amqp from 'amqplib';
import type { Channel, ConfirmChannel } from 'amqplib';
import { env } from '../config/env';

export type AmqpConnection = Awaited<ReturnType<typeof amqp.connect>>;

export const QUEUES = {
  requests: 'consultation.requests',
  requestsDlq: 'consultation.requests.dlq',
  results: 'consultation.results',
} as const;

export interface ConsultationRequestMessage {
  transactionId: number;
  customerId: number;
  userId: number;
  requestedAt: string;
}

export interface ConsultationResultMessage {
  transactionId: number;
  customerId: number;
  userId: number;
  status: 'COMPLETED' | 'FAILED';
  result?: unknown;
  error?: string;
  completedAt: string;
}

export interface ConsultationDeadLetterMessage {
  transactionId: number;
  customerId: number;
  userId: number;
  error: string;
  failedAt: string;
}

/** Declara filas de forma idempotente. Os argumentos precisam ser iguais em todos os serviços. */
export async function assertTopology(channel: Channel): Promise<void> {
  await channel.assertQueue(QUEUES.requestsDlq, { durable: true });
  await channel.assertQueue(QUEUES.requests, {
    durable: true,
    arguments: {
      'x-dead-letter-exchange': '',
      'x-dead-letter-routing-key': QUEUES.requestsDlq,
    },
  });
  await channel.assertQueue(QUEUES.results, { durable: true });
}

export async function connectRabbit(retries = 30, delayMs = 2000): Promise<AmqpConnection> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const connection = await amqp.connect(env.rabbitmqUrl);
      connection.on('error', (err) => console.error('[rabbitmq] erro de conexão', err));
      connection.on('close', () => console.warn('[rabbitmq] conexão fechada'));
      return connection;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[rabbitmq] aguardando RabbitMQ (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error('Não foi possível conectar ao RabbitMQ');
}

/** Publica uma mensagem persistente e aguarda a confirmação (publisher confirm) do broker. */
export function publishJson(channel: ConfirmChannel, queue: string, payload: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    channel.sendToQueue(
      queue,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: 'application/json' },
      (err) => (err ? reject(err) : resolve()),
    );
  });
}
