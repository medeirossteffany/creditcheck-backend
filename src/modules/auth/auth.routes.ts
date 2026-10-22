import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, signToken } from '../../middlewares/auth';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { findUserByEmailWithPassword, findUserById } from '../users/users.service';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

// Hash válido usado quando o e-mail não existe, para manter tempo de resposta similar.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

export const authRouter = Router();

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await findUserByEmailWithPassword(email);
    const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !passwordOk) {
      throw new AppError(401, 'E-mail ou senha inválidos');
    }

    const { password_hash: _ignored, ...publicUser } = user;
    const token = signToken({ id: user.id, email: user.email, role: user.role });
    res.json({ token, user: publicUser });
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await findUserById(req.user!.id);
    if (!user) throw new AppError(401, 'Usuário não encontrado');
    res.json(user);
  }),
);
