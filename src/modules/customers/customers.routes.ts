import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { isValidCpf } from '../../utils/cpf';
import { ROLES } from '../users/users.service';
import { requestConsultation } from '../consultations/consultations.service';
import { createCustomer, CUSTOMER_STATUSES, getCustomerDetails, listCustomers } from './customers.service';

const createCustomerSchema = z.object({
  name: z.string().trim().min(2).max(150),
  cpf: z.string().trim().refine(isValidCpf, 'CPF inválido'),
});

const listQuerySchema = z.object({
  name: z.string().trim().max(150).optional(),
  cpf: z.string().trim().max(14).optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const customersRouter = Router();

customersRouter.use(authenticate, requireRole(ROLES.ADMIN));

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createCustomerSchema.parse(req.body);
    res.status(201).json(await createCustomer(input));
  }),
);

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filters = listQuerySchema.parse(req.query);
    res.json(await listCustomers(filters));
  }),
);

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json(await getCustomerDetails(id));
  }),
);

// Botão "Consultar": reutiliza consulta válida (<24h) ou enfileira uma nova.
customersRouter.post(
  '/:id/consultations',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const outcome = await requestConsultation(id, req.user!.id);
    res.status(outcome.status === 'PENDING' ? 202 : 200).json(outcome);
  }),
);
