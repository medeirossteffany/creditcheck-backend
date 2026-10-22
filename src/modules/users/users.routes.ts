import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middlewares/auth';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { createUser, findUserById, listUsers, ROLES } from './users.service';

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const createUserSchema = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(150),
  password: z.string().min(8).max(100),
});

export const usersRouter = Router();

usersRouter.use(authenticate, requireRole(ROLES.ADMIN));

// Cadastro de novos administradores (apenas admins autenticados).
usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createUserSchema.parse(req.body);
    const user = await createUser({ ...input, role: ROLES.ADMIN });
    res.status(201).json(user);
  }),
);

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await listUsers());
  }),
);

usersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const user = await findUserById(id);
    if (!user) throw new AppError(404, 'Usuário não encontrado');
    res.json(user);
  }),
);
