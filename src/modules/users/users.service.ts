import bcrypt from 'bcryptjs';
import { DatabaseError } from 'pg';
import { pool, withTransaction } from '../../db/pool';
import { AppError } from '../../utils/AppError';

export const ROLES = { ADMIN: 'ADMIN' } as const;

export interface PublicUser {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: Date;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: string;
}

const PUBLIC_COLUMNS = 'id, name, email, role, created_at';

/**
 * Cria um usuário dentro de uma transação (node-postgres).
 * Em caso de qualquer erro é feito ROLLBACK e nada é persistido.
 */
export async function createUser(input: CreateUserInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(input.password, 10);

  try {
    return await withTransaction(async (client) => {
      const existing = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (existing.rowCount) {
        throw new AppError(409, 'E-mail já cadastrado');
      }

      const { rows } = await client.query<PublicUser>(
        `INSERT INTO users (name, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         RETURNING ${PUBLIC_COLUMNS}`,
        [input.name.trim(), email, passwordHash, input.role ?? ROLES.ADMIN],
      );
      return rows[0];
    });
  } catch (err) {
    // Corrida entre duas criações simultâneas com o mesmo e-mail.
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new AppError(409, 'E-mail já cadastrado');
    }
    throw err;
  }
}

export async function findUserByEmailWithPassword(
  email: string,
): Promise<(PublicUser & { password_hash: string }) | null> {
  const { rows } = await pool.query(
    `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<PublicUser | null> {
  const { rows } = await pool.query<PublicUser>(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function listUsers(): Promise<PublicUser[]> {
  const { rows } = await pool.query<PublicUser>(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY created_at DESC, id DESC`,
  );
  return rows;
}

/** Cria o administrador inicial a partir de ADMIN_EMAIL/ADMIN_PASSWORD se ainda não existir. */
export async function ensureAdminUser(admin: { name: string; email: string; password: string }): Promise<void> {
  if (!admin.email || !admin.password) {
    console.warn('[seed] ADMIN_EMAIL/ADMIN_PASSWORD não definidos; seed do admin ignorado');
    return;
  }
  if (await findUserByEmailWithPassword(admin.email)) return;

  try {
    const user = await createUser({ ...admin, role: ROLES.ADMIN });
    console.log(`[seed] administrador criado: ${user.email}`);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 409) return;
    throw err;
  }
}
