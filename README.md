# creditcheck-backend

API Node.js (TypeScript + Express) para consulta de crédito de clientes, com autenticação JWT,
PostgreSQL, RabbitMQ e notificação em tempo real (Socket.IO) para o front-end React.

## Arquitetura

```
React ──HTTP (JWT)──▶ API ──▶ PostgreSQL
  ▲                    │
  │ Socket.IO          │ publica consultation.requests
  │                    ▼
  └──── API ◀── consultation.results ◀── Worker ──HTTP──▶ API externa (mock)
                                           │
                                           └──▶ PostgreSQL (consultations / transactions)
```

| Serviço             | Comando               | Porta |
|---------------------|-----------------------|-------|
| `api`               | `npm start`           | 3000  |
| `worker`            | `npm run start:worker`| -     |
| `mock-external-api` | `npm run start:mock`  | 4000  |
| `postgres`          | -                     | 5432  |
| `rabbitmq`          | - (painel em :15672, guest/guest) | 5672 |

O schema do banco é versionado com `node-pg-migrate` em `migrations/`. No Docker, um serviço
executa as migrações antes da API e do worker. Na execução local, rode `npm run migrate:up`
após iniciar o PostgreSQL. `npm run migrate:down` reverte a última migração.
Como a migração inicial remove as tabelas no rollback, use `migrate:down` apenas em ambiente
local/de desenvolvimento sem dados que precisem ser preservados.

O administrador inicial é criado a partir de `ADMIN_EMAIL` / `ADMIN_PASSWORD` dentro de uma
transação SQL (`BEGIN` / `COMMIT`, com `ROLLBACK` em caso de erro — ver `withTransaction` em
`src/db/pool.ts`).

## Como rodar

### Tudo via Docker

```bash
docker compose up --build
```

Login padrão: `admin@creditcheck.local` / `Admin@12345` (altere via variáveis de ambiente).

### Desenvolvimento local

```bash
cp .env.example .env
npm install
docker compose up -d postgres rabbitmq
npm run migrate:up
npm run seed:admin
npm run dev:mock     # terminal 1
npm run dev          # terminal 2 (API)
npm run dev:worker   # terminal 3
```

## Fluxo de consulta

1. `POST /customers/:id/consultations`
2. Se existe consulta com `expires_at > NOW()` (24h) para o cliente → retorna `200` com o resultado (`cached: true`), sem custo.
3. Se já existe uma transação `PENDING` recente → retorna `202` com ela (`alreadyInProgress: true`), evitando cobrança duplicada.
4. Senão → cria `transactions` com `PENDING`, publica em `consultation.requests` e retorna `202`.
5. O Worker chama a API externa (timeout + retry em falhas transitórias):
   - **Sucesso (HTTP 200 da API mockada):** em uma transação SQL grava `consultations` (com `expires_at = completed_at + 24h`) e marca `COMPLETED`.
   - **Erro:** marca `FAILED` com `error_message`, sem criar registro em `consultations`.
   - Em ambos os casos publica uma notificação na fila RabbitMQ `consultation.results`. Essa fila não é a tabela `consultations`: ela transporta tanto sucesso quanto erro para o front.
6. A API consome `consultation.results` e emite o evento `consultation:updated` via Socket.IO para os admins conectados.

Falhas de infraestrutura no worker (ex.: banco indisponível) são registradas nos logs do worker e
enviadas para `consultation.requests.dlq` junto com o motivo. O próprio worker consome essa DLQ:
quando o banco volta, marca a transação como `FAILED`, salva o erro em `transactions.error_message`
e publica o resultado em `consultation.results` para notificar o front. Se o banco ou o RabbitMQ
continuar indisponível, a mensagem é reencaminhada para a DLQ com uma pausa de 5 segundos antes da
tentativa seguinte.

A API mockada responde `422` para CPF inválido e simula indisponibilidade com falhas `503`
aleatórias, cuja probabilidade é definida por `MOCK_FAILURE_RATE` no .env (0 a 1; `1` faz todas as
chamadas falharem).

## Endpoints

Todas as rotas, exceto `/auth/login` e `/health`, exigem `Authorization: Bearer <token>` de um usuário `ADMIN`.

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/auth/login` | `{ email, password }` → `{ token, user }` |
| GET  | `/auth/me` | Usuário autenticado |
| POST | `/users` | Cadastra novo administrador `{ name, email, password }` |
| GET  | `/users` | Lista administradores (sem `password_hash`) |
| GET  | `/users/:id` | Dados de um administrador |
| POST | `/customers` | Cadastra cliente `{ name, cpf }` (CPF validado e salvo só com dígitos) |
| GET  | `/customers?name=&cpf=&status=&page=&pageSize=` | Tabela paginada; `status` ∈ `NOT_CONSULTED, PENDING, COMPLETED, FAILED` |
| GET  | `/customers/:id` | Detalhes: dados, status, consulta válida e histórico de transações |
| POST | `/customers/:id/consultations` | Botão "Consultar" |
| GET  | `/transactions/:id` | Status/resultado de uma transação (fallback de polling) |

