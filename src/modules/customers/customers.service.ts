import { DatabaseError } from 'pg';
import { pool } from '../../db/pool';
import { AppError } from '../../utils/AppError';
import { normalizeCpf } from '../../utils/cpf';

export const CUSTOMER_STATUSES = ['NOT_CONSULTED', 'PENDING', 'COMPLETED', 'FAILED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export interface Customer {
  id: number;
  name: string;
  cpf: string;
  created_at: Date;
}

export interface ListCustomersFilters {
  name?: string;
  cpf?: string;
  status?: CustomerStatus;
  page: number;
  pageSize: number;
}

export async function createCustomer(input: { name: string; cpf: string }): Promise<Customer> {
  try {
    const { rows } = await pool.query<Customer>(
      `INSERT INTO customers (name, cpf) VALUES ($1, $2)
       RETURNING id, name, cpf, created_at`,
      [input.name.trim(), normalizeCpf(input.cpf)],
    );
    return rows[0];
  } catch (err) {
    if (err instanceof DatabaseError && err.code === '23505') {
      throw new AppError(409, 'CPF já cadastrado');
    }
    throw err;
  }
}

/**
 * Lista clientes com o status da última transação (consulta) de cada um.
 * Status `NOT_CONSULTED` = cliente sem nenhuma transação.
 */
export async function listCustomers(filters: ListCustomersFilters) {
  const offset = (filters.page - 1) * filters.pageSize;
  const { rows } = await pool.query(
    `WITH base AS (
       SELECT c.id, c.name, c.cpf, c.created_at,
              COALESCE(t.status, 'NOT_CONSULTED') AS status,
              t.id         AS last_transaction_id,
              t.created_at AS last_consulted_at
         FROM customers c
         LEFT JOIN LATERAL (
           SELECT id, status, created_at
             FROM transactions
            WHERE customer_id = c.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
         ) t ON TRUE
        WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR c.cpf LIKE $2 || '%')
          AND ($3::text IS NULL OR COALESCE(t.status, 'NOT_CONSULTED') = $3)
     )
     SELECT (SELECT COUNT(*) FROM base)::int AS total,
            COALESCE(
              (SELECT json_agg(p) FROM (
                 SELECT * FROM base ORDER BY created_at DESC, id DESC LIMIT $4 OFFSET $5
               ) p),
              '[]'::json
            ) AS items`,
    [
      filters.name || null,
      filters.cpf ? normalizeCpf(filters.cpf) || null : null,
      filters.status ?? null,
      filters.pageSize,
      offset,
    ],
  );

  const { total, items } = rows[0];
  return {
    items,
    page: filters.page,
    pageSize: filters.pageSize,
    total,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function findCustomerById(id: number): Promise<Customer | null> {
  const { rows } = await pool.query<Customer>(
    'SELECT id, name, cpf, created_at FROM customers WHERE id = $1',
    [id],
  );
  return rows[0] ?? null;
}

/** Detalhes do cliente: dados cadastrais, status atual, consulta válida (se houver) e histórico. */
export async function getCustomerDetails(id: number) {
  const customer = await findCustomerById(id);
  if (!customer) throw new AppError(404, 'Cliente não encontrado');

  const [history, validConsultation] = await Promise.all([
    pool.query(
      `SELECT t.id, t.status, t.error_message, t.created_at, t.completed_at,
              u.id AS user_id, u.name AS user_name
         FROM transactions t
         JOIN users u ON u.id = t.user_id
        WHERE t.customer_id = $1
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 20`,
      [id],
    ),
    pool.query(
      `SELECT co.id, co.transaction_id, co.result, co.completed_at, co.expires_at
         FROM consultations co
         JOIN transactions t ON t.id = co.transaction_id
        WHERE t.customer_id = $1 AND co.expires_at > NOW()
        ORDER BY co.completed_at DESC
        LIMIT 1`,
      [id],
    ),
  ]);

  return {
    ...customer,
    status: (history.rows[0]?.status ?? 'NOT_CONSULTED') as CustomerStatus,
    validConsultation: validConsultation.rows[0] ?? null,
    transactions: history.rows,
  };
}
