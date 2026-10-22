import { withTransaction } from '../db/pool';
import {
  ConsultationDeadLetterMessage,
  ConsultationResultMessage,
} from '../messaging/rabbitmq';

interface TransactionState {
  id: number;
  customer_id: number;
  user_id: number;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  error_message: string | null;
  completed_at: Date | null;
  result: unknown | null;
  consultation_completed_at: Date | null;
}

/** Registra falhas de infraestrutura na transação e cria o evento a ser enviado ao front. */
export async function processDeadLetter(
  message: ConsultationDeadLetterMessage,
): Promise<ConsultationResultMessage | null> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<TransactionState>(
      `SELECT t.id, t.customer_id, t.user_id, t.status, t.error_message, t.completed_at,
              co.result, co.completed_at AS consultation_completed_at
         FROM transactions t
         LEFT JOIN consultations co ON co.transaction_id = t.id
        WHERE t.id = $1
        FOR UPDATE OF t`,
      [message.transactionId],
    );
    const transaction = rows[0];

    if (!transaction) {
      console.warn(`[worker] transação ${message.transactionId} não existe; descartando mensagem da DLQ`);
      return null;
    }

    if (transaction.status === 'PENDING') {
      const error = `Falha de infraestrutura no worker: ${message.error}`;
      const { rows: updated } = await client.query<{ completed_at: Date }>(
        `UPDATE transactions
            SET status = 'FAILED', error_message = $2, completed_at = NOW()
          WHERE id = $1 AND status = 'PENDING'
          RETURNING completed_at`,
        [transaction.id, error],
      );

      if (!updated[0]) {
        throw new Error(`Não foi possível marcar a transação ${transaction.id} como FAILED`);
      }

      return {
        transactionId: transaction.id,
        customerId: transaction.customer_id,
        userId: transaction.user_id,
        status: 'FAILED',
        error,
        completedAt: updated[0].completed_at.toISOString(),
      };
    }

    if (transaction.status === 'COMPLETED' && transaction.result !== null) {
      return {
        transactionId: transaction.id,
        customerId: transaction.customer_id,
        userId: transaction.user_id,
        status: 'COMPLETED',
        result: transaction.result,
        completedAt: (transaction.consultation_completed_at ?? transaction.completed_at!).toISOString(),
      };
    }

    return {
      transactionId: transaction.id,
      customerId: transaction.customer_id,
      userId: transaction.user_id,
      status: 'FAILED',
      error: transaction.error_message ?? `Falha de infraestrutura no worker: ${message.error}`,
      completedAt: (transaction.completed_at ?? new Date()).toISOString(),
    };
  });
}
