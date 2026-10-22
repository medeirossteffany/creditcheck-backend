import { env } from '../config/env';
import { waitForDatabase } from '../db/waitForDatabase';
import { pool } from '../db/pool';
import {
  assertTopology,
  connectRabbit,
  ConsultationDeadLetterMessage,
  ConsultationRequestMessage,
  publishJson,
  QUEUES,
} from '../messaging/rabbitmq';
import { processDeadLetter } from './processDeadLetter';
import { processConsultation } from './processConsultation';

async function main(): Promise<void> {
  await waitForDatabase();

  const rabbit = await connectRabbit();
  rabbit.on('close', () => {
    console.error('[worker] conexão com RabbitMQ perdida, encerrando para reinício');
    process.exit(1);
  });

  const publishChannel = await rabbit.createConfirmChannel();
  await assertTopology(publishChannel);

  const consumeChannel = await rabbit.createChannel();
  await assertTopology(consumeChannel);
  await consumeChannel.prefetch(env.workerPrefetch);

  const dlqChannel = await rabbit.createChannel();
  await assertTopology(dlqChannel);
  await dlqChannel.prefetch(1);

  await consumeChannel.consume(QUEUES.requests, async (msg) => {
    if (!msg) return;

    let request: ConsultationRequestMessage;
    try {
      request = JSON.parse(msg.content.toString());
    } catch {
      console.error('[worker] mensagem malformada enviada para DLQ');
      consumeChannel.nack(msg, false, false);
      return;
    }

    try {
      const outcome = await processConsultation(request);
      if (outcome) {
        await publishJson(publishChannel, QUEUES.results, outcome);
      }
      consumeChannel.ack(msg);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[worker] erro ao processar transação ${request.transactionId}, enviando para DLQ`, err);
      const deadLetter: ConsultationDeadLetterMessage = {
        transactionId: request.transactionId,
        customerId: request.customerId,
        userId: request.userId,
        error: reason.slice(0, 1000),
        failedAt: new Date().toISOString(),
      };

      try {
        await publishJson(publishChannel, QUEUES.requestsDlq, deadLetter);
        consumeChannel.ack(msg);
      } catch (publishError) {
        console.error('[worker] falha ao registrar mensagem na DLQ; solicitação será reentregue', publishError);
        consumeChannel.nack(msg, false, true);
      }
    }
  });

  await dlqChannel.consume(QUEUES.requestsDlq, async (msg) => {
    if (!msg) return;

    let deadLetter: ConsultationDeadLetterMessage;
    try {
      const payload: unknown = JSON.parse(msg.content.toString());
      if (
        typeof payload !== 'object' ||
        payload === null ||
        !('transactionId' in payload) ||
        !('customerId' in payload) ||
        !('userId' in payload) ||
        !('error' in payload) ||
        typeof payload.transactionId !== 'number' ||
        typeof payload.customerId !== 'number' ||
        typeof payload.userId !== 'number' ||
        typeof payload.error !== 'string'
      ) {
        throw new Error('Formato de mensagem inesperado');
      }
      deadLetter = payload as ConsultationDeadLetterMessage;
    } catch (err) {
      console.error('[worker] mensagem inválida na DLQ, descartando', err);
      dlqChannel.ack(msg);
      return;
    }

    try {
      const outcome = await processDeadLetter(deadLetter);
      if (outcome) {
        await publishJson(publishChannel, QUEUES.results, outcome);
      }
      dlqChannel.ack(msg);
    } catch (err) {
      console.error(
        `[worker] não foi possível concluir mensagem da DLQ para transação ${deadLetter.transactionId}; tentará novamente`,
        err,
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      try {
        dlqChannel.nack(msg, false, true);
      } catch (nackError) {
        console.error('[worker] falha ao reencaminhar mensagem para a DLQ', nackError);
      }
    }
  });

  console.log(`[worker] consumindo fila ${QUEUES.requests}`);
  console.log(`[worker] consumindo fila ${QUEUES.requestsDlq}`);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} recebido, encerrando...`);
    rabbit.removeAllListeners('close');
    await rabbit.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] falha ao iniciar', err);
  process.exit(1);
});
