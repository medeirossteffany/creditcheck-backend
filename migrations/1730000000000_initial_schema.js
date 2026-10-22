/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  pgm.createTable('users', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'varchar(150)', notNull: true },
    email: { type: 'varchar(150)', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    role: { type: 'varchar(30)', notNull: true, default: 'ADMIN' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('customers', {
    id: { type: 'serial', primaryKey: true },
    name: { type: 'varchar(150)', notNull: true },
    cpf: { type: 'varchar(14)', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('transactions', {
    id: { type: 'serial', primaryKey: true },
    customer_id: {
      type: 'integer',
      notNull: true,
      references: '"customers"',
      onDelete: 'RESTRICT',
    },
    user_id: {
      type: 'integer',
      notNull: true,
      references: '"users"',
      onDelete: 'RESTRICT',
    },
    status: { type: 'varchar(30)', notNull: true },
    error_message: { type: 'text' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    completed_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('transactions', 'transactions_status_check', {
    check: "status IN ('PENDING', 'COMPLETED', 'FAILED')",
  });
  pgm.createIndex('transactions', ['customer_id', 'created_at'], {
    name: 'idx_transactions_customer_created',
  });

  pgm.createTable('consultations', {
    id: { type: 'serial', primaryKey: true },
    transaction_id: {
      type: 'integer',
      notNull: true,
      unique: true,
      references: '"transactions"',
      onDelete: 'RESTRICT',
    },
    user_id: {
      type: 'integer',
      notNull: true,
      references: '"users"',
      onDelete: 'RESTRICT',
    },
    result: { type: 'jsonb', notNull: true },
    completed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
  });
  pgm.createIndex('consultations', 'expires_at', { name: 'idx_consultations_expires_at' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  pgm.dropTable('consultations');
  pgm.dropTable('transactions');
  pgm.dropTable('customers');
  pgm.dropTable('users');
};
