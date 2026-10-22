import { env } from '../config/env';

export class ExternalApiError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ExternalApiError';
  }
}

const MAX_ATTEMPTS = 3;

/** Chama a API externa de análise de crédito, com timeout e retry para falhas transitórias. */
export async function fetchCreditAnalysis(input: { name: string; cpf: string }): Promise<unknown> {
  let lastError: ExternalApiError | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${env.externalApiUrl}/v1/credit-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(env.externalApiTimeoutMs),
      });

      if (response.status === 200) return await response.json();

      const body = (await response.text()).slice(0, 300);
      const retryable = response.status >= 500 || response.status === 429;
      lastError = new ExternalApiError(`API externa respondeu ${response.status}: ${body}`, retryable);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      lastError = new ExternalApiError(`Falha de comunicação com a API externa: ${reason}`, true);
    }

    if (!lastError.retryable || attempt === MAX_ATTEMPTS) break;
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
  }

  throw lastError ?? new ExternalApiError('Erro desconhecido na API externa', false);
}
