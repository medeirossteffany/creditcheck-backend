import { Pool, PoolClient } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

pool.on('error', (err) => {
  console.error('[db] erro inesperado em cliente ocioso', err);
});

/**
 * Executa `fn` dentro de uma transação SQL (BEGIN/COMMIT).
 * Qualquer erro lançado dentro de `fn` provoca ROLLBACK.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch((rollbackErr) => {
      console.error('[db] falha ao executar ROLLBACK', rollbackErr);
    });
    throw err;
  } finally {
    client.release();
  }
}
