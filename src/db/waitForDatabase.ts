import { pool } from './pool';

/** Aguarda o Postgres aceitar conexões (útil ao subir com docker-compose). */
export async function waitForDatabase(retries = 30, delayMs = 2000): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`[db] aguardando Postgres (${attempt}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
