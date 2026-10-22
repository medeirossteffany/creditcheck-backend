/**
 * API externa MOCK de análise de crédito (simula um bureau como Serasa/SPC).
 * - Latência aleatória entre 300ms e 1500ms.
 * - CPF inválido retorna 422.
 * - Falha 503 aleatória conforme MOCK_FAILURE_RATE (0..1).
 * - Score determinístico a partir do CPF.
 */
import { randomUUID } from 'crypto';
import express from 'express';
import { isValidCpf, normalizeCpf } from '../utils/cpf';

const port = Number(process.env.MOCK_PORT ?? 4000);
const failureRate = Number(process.env.MOCK_FAILURE_RATE ?? 0);

const app = express();
app.use(express.json());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/v1/credit-analysis', async (req, res) => {
  const { name, cpf } = (req.body ?? {}) as { name?: unknown; cpf?: unknown };
  if (typeof name !== 'string' || typeof cpf !== 'string') {
    res.status(400).json({ error: 'name e cpf são obrigatórios' });
    return;
  }

  await sleep(300 + Math.floor(Math.random() * 1200));

  if (!isValidCpf(cpf)) {
    res.status(422).json({ error: 'CPF inválido' });
    return;
  }
  if (Math.random() < failureRate) {
    res.status(503).json({ error: 'Serviço temporariamente indisponível' });
    return;
  }

  const digits = normalizeCpf(cpf);
  const hash = [...digits].reduce((acc, d, i) => acc + Number(d) * (i + 7), 0);
  const score = 300 + ((hash * 37) % 651);
  const risk = score >= 700 ? 'LOW' : score >= 500 ? 'MEDIUM' : 'HIGH';
  const restrictions =
    risk === 'HIGH'
      ? [
          { type: 'PROTESTO', amount: 1520.75, origin: 'Cartório 1º Ofício', date: '2025-03-14' },
          { type: 'DIVIDA_VENCIDA', amount: 389.9, origin: 'Telecom S.A.', date: '2025-08-02' },
        ]
      : risk === 'MEDIUM'
        ? [{ type: 'DIVIDA_VENCIDA', amount: 210.0, origin: 'Varejo LTDA', date: '2026-01-20' }]
        : [];

  res.json({
    protocol: randomUUID(),
    provider: 'MockBureau',
    name,
    cpf: digits,
    score,
    risk,
    hasRestrictions: restrictions.length > 0,
    restrictions,
    consultedAt: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`[mock-external-api] ouvindo na porta ${port} (failureRate=${failureRate})`);
});
