import type { ConfirmChannel } from 'amqplib';
import { AmqpConnection, assertTopology, ConsultationRequestMessage, publishJson, QUEUES } from './rabbitmq';

let publisherChannel: ConfirmChannel | null = null;

export async function initPublisher(connection: AmqpConnection): Promise<void> {
  publisherChannel = await connection.createConfirmChannel();
  await assertTopology(publisherChannel);
  publisherChannel.on('close', () => {
    publisherChannel = null;
  });
}

export async function publishConsultationRequest(message: ConsultationRequestMessage): Promise<void> {
  if (!publisherChannel) {
    throw new Error('Canal do RabbitMQ indisponível');
  }
  await publishJson(publisherChannel, QUEUES.requests, message);
}
