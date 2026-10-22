import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Rota não encontrada' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Dados inválidos', details: err.flatten().fieldErrors });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, details: err.details });
    return;
  }
  console.error('[api] erro não tratado', err);
  res.status(500).json({ error: 'Erro interno do servidor' });
}
