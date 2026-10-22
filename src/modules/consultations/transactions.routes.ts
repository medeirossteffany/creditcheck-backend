import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ROLES } from '../users/users.service';
import { getTransaction } from './consultations.service';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const transactionsRouter = Router();

transactionsRouter.use(authenticate, requireRole(ROLES.ADMIN));

// Fallback para o front caso o WebSocket caia (polling do status).
transactionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await getTransaction(id));
  }),
);
