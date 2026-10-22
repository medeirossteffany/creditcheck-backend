import cors from 'cors';
import express from 'express';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { transactionsRouter } from './modules/consultations/transactions.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { usersRouter } from './modules/users/users.routes';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/customers', customersRouter);
  app.use('/transactions', transactionsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
