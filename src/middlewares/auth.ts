import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

export interface AuthUser {
  id: number;
  email: string;
  role: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ email: user.email, role: user.role }, env.jwtSecret, {
    subject: String(user.id),
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  if (!payload.sub) throw new AppError(401, 'Token inválido');
  return { id: Number(payload.sub), email: String(payload.email), role: String(payload.role) };
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new AppError(401, 'Token não informado'));
  }
  try {
    req.user = verifyToken(header.slice('Bearer '.length));
    next();
  } catch {
    next(new AppError(401, 'Token inválido ou expirado'));
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new AppError(403, 'Acesso negado'));
    }
    next();
  };
}
