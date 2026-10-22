import { env } from '../../config/env';
import { pool, withTransaction } from '../../db/pool';
import { publishConsultationRequest } from '../../messaging/publisher';
import { AppError } from '../../utils/AppError';

export type ConsultationRequestOutcome =
  | {
      status: 'COMPLETED';
      cached: true;
      transactionId: number;
      consultation: { id: number; result: unknown; completed_at: Date; expires_at: Date };
    }
  | {
      status: 'PENDING';
      cached: false;
      transactionId: number;
      alreadyInProgress: boolean;
    };

/**
 * Fluxo do botão "Consultar":
 * 1. Se existir consulta válida (expires_at > agora) para o cliente, reutiliza (sem custo).
 * 2. Se já houver uma transação PENDING recente, devolve ela (evita cobrança duplicada).
 * 3. Senão, cria transaction PENDING e publica a solicitação no RabbitMQ.
 */
export async function requestConsultation(customerId: number, userId: number): Promise<ConsultationRequestOutcome> {
  const decision = await withTransaction(async (client) => {
    // Lock por cliente: serializa cliques simultâneos para o mesmo cliente.
    const customer = await client.query('SELECT id FROM customers WHERE id = $1 FOR UPDATE', [customerId]);
    if (!customer.rowCount) throw new AppError(404, 'Cliente não encontrado');

    const cached = await client.query(
      `SELECT co.id, co.transaction_id, co.result, co.completed_at, co.expires_at
         FROM consultations co
         JOIN transactions t ON t.id = co.transaction_id
        WHERE t.customer_id = $1
          AND t.status = 'COMPLETED'
          AND co.expires_at > NOW()
        ORDER BY co.completed_at DESC
        LIMIT 1`,
      [customerId],
    );
    if (cached.rowCount) {
      const { transaction_id, ...consultation } = cached.rows[0];
      return { kind: 'cached' as const, transactionId: transaction_id as number, consultation };
    }

    const pending = await client.query<{ id: number }>(
      `SELECT id FROM transactions
        WHERE customer_id = $1
          AND status = 'PENDING'
          AND created_at > NOW() - ($2::int * INTERVAL '1 minute')
        ORDER BY created_at DESC
        LIMIT 1`,
      [customerId, env.pendingTimeoutMinutes],
    );
    if (pending.rowCount) {
      return { kind: 'pending' as const, transactionId: pending.rows[0].id };
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO transactions (customer_id, user_id, status)
       VALUES ($1, $2, 'PENDING')
       RETURNING id`,
      [customerId, userId],
    );
    return { kind: 'new' as const, transactionId: inserted.rows[0].id };
  });

  if (decision.kind === 'cached') {
    return { status: 'COMPLETED', cached: true, transactionId: decision.transactionId, consultation: decision.consultation };
  }

  if (decision.kind === 'new') {
    // Publica somente após o COMMIT, para o worker sempre encontrar a transação no banco.
    try {
      await publishConsultationRequest({
        transactionId: decision.transactionId,
        customerId,
        userId,
        requestedAt: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[consultations] falha ao publicar no RabbitMQ', err);
      await pool.query(
        `UPDATE transactions
            SET status = 'FAILED', error_message = $2, completed_at = NOW()
          WHERE id = $1 AND status = 'PENDING'`,
        [decision.transactionId, 'Falha ao enfileirar a consulta'],
      );
      throw new AppError(503, 'Serviço de consulta indisponível, tente novamente');
    }
  }

  return {
    status: 'PENDING',
    cached: false,
    transactionId: decision.transactionId,
    alreadyInProgress: decision.kind === 'pending',
  };
}

export async function getTransaction(id: number) {
  const { rows } = await pool.query(
    `SELECT t.id, t.customer_id, t.user_id, t.status, t.error_message, t.created_at, t.completed_at,
            CASE WHEN co.id IS NULL THEN NULL ELSE json_build_object(
              'id', co.id,
              'result', co.result,
              'completed_at', co.completed_at,
              'expires_at', co.expires_at
            ) END AS consultation
       FROM transactions t
       LEFT JOIN consultations co ON co.transaction_id = t.id
      WHERE t.id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'Transação não encontrada');
  return rows[0];
}
