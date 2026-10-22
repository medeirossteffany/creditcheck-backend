import { env } from '../config/env';
import { pool, withTransaction } from '../db/pool';
import { ConsultationRequestMessage, ConsultationResultMessage } from '../messaging/rabbitmq';
import { fetchCreditAnalysis } from './externalCreditApi';

interface PendingTransactionRow {
  id: number;
  status: string;
  user_id: number;
  customer_id: number;
  name: string;
  cpf: string;
}

/**
 * Processa uma solicitação de consulta.
 * Retorna a mensagem de resultado a ser publicada, ou `null` se não houver nada a fazer
 * (transação inexistente ou já finalizada — garante idempotência em reentregas).
 */
export async function processConsultation(
  message: ConsultationRequestMessage,
): Promise<ConsultationResultMessage | null> {
  const { rows } = await pool.query<PendingTransactionRow>(
    `SELECT t.id, t.status, t.user_id, c.id AS customer_id, c.name, c.cpf
       FROM transactions t
       JOIN customers c ON c.id = t.customer_id
      WHERE t.id = $1`,
    [message.transactionId],
  );
  const tx = rows[0];

  if (!tx) {
    console.warn(`[worker] transação ${message.transactionId} não encontrada, ignorando`);
    return null;
  }
  if (tx.status !== 'PENDING') {
    console.info(`[worker] transação ${tx.id} já está ${tx.status}, ignorando`);
    return null;
  }

  const base = { transactionId: tx.id, customerId: tx.customer_id, userId: tx.user_id };

  try {
    const result = await fetchCreditAnalysis({ name: tx.name, cpf: tx.cpf });

    const completedAt = await withTransaction(async (client) => {
      const updated = await client.query<{ completed_at: Date }>(
        `UPDATE transactions
            SET status = 'COMPLETED', completed_at = NOW(), error_message = NULL
          WHERE id = $1 AND status = 'PENDING'
          RETURNING completed_at`,
        [tx.id],
      );
      if (!updated.rowCount) return null;

      const finishedAt = updated.rows[0].completed_at;
      await client.query(
        `INSERT INTO consultations (transaction_id, user_id, result, completed_at, expires_at)
         VALUES ($1, $2, $3, $4, $4::timestamptz + ($5::int * INTERVAL '1 hour'))`,
        [tx.id, tx.user_id, JSON.stringify(result), finishedAt, env.consultationTtlHours],
      );
      return finishedAt;
    });

    if (!completedAt) return null;
    console.log(`[worker] transação ${tx.id} concluída`);
    return { ...base, status: 'COMPLETED', result, completedAt: completedAt.toISOString() };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[worker] transação ${tx.id} falhou: ${errorMessage}`);

    const failed = await pool.query<{ completed_at: Date }>(
      `UPDATE transactions
          SET status = 'FAILED', error_message = $2, completed_at = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING completed_at`,
      [tx.id, errorMessage],
    );
    if (!failed.rowCount) return null;

    return { ...base, status: 'FAILED', error: errorMessage, completedAt: failed.rows[0].completed_at.toISOString() };
  }
}
