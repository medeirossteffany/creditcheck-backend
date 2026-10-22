import { NextFunction, Request, RequestHandler, Response } from 'express';

/** Encaminha erros de handlers async para o middleware de erro (Express 4). */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
