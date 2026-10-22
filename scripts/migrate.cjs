require('dotenv').config();

const path = require('path');
const { runner } = require('node-pg-migrate');

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  console.error('Uso: npm run migrate:up | npm run migrate:down');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL não definido');
  process.exit(1);
}

runner({
  databaseUrl: process.env.DATABASE_URL,
  dir: path.resolve(__dirname, '..', 'migrations'),
  direction,
  migrationsTable: 'pgmigrations',
  count: direction === 'down' ? 1 : undefined,
})
  .then(() => {
    console.log(`[migrations] ${direction} concluído`);
  })
  .catch((err) => {
    console.error(`[migrations] falha ao executar ${direction}`, err);
    process.exitCode = 1;
  });
