/**
 * Cria o administrador definido em ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD.
 * Uso: npm run seed:admin
 */
import { env } from '../config/env';
import { waitForDatabase } from '../db/waitForDatabase';
import { pool } from '../db/pool';
import { ensureAdminUser } from '../modules/users/users.service';

async function main(): Promise<void> {
  await waitForDatabase();
  await ensureAdminUser(env.admin);
}

main()
  .catch((err) => {
    console.error('[seed] falha', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
