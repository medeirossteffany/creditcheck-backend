import 'dotenv/config';

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: toNumber(process.env.PORT, 3000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  databaseUrl: process.env.DATABASE_URL ?? 'postgres://creditcheck:creditcheck@localhost:5432/creditcheck',
  rabbitmqUrl: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',

  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',

  externalApiUrl: process.env.EXTERNAL_API_URL ?? 'http://localhost:4000',
  externalApiTimeoutMs: toNumber(process.env.EXTERNAL_API_TIMEOUT_MS, 10_000),
  consultationTtlHours: toNumber(process.env.CONSULTATION_TTL_HOURS, 24),
  pendingTimeoutMinutes: toNumber(process.env.PENDING_TIMEOUT_MINUTES, 10),
  workerPrefetch: toNumber(process.env.WORKER_PREFETCH, 5),

  admin: {
    name: process.env.ADMIN_NAME ?? 'Administrador',
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
  },
};

export function assertApiEnv(): void {
  if (!env.jwtSecret || env.jwtSecret.length < 16) {
    throw new Error('JWT_SECRET não definido ou muito curto (mínimo 16 caracteres)');
  }
}
