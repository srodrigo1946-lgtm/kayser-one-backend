# Kayser One — Backend API

Backend da plataforma Kayser One CRM, construído com NestJS + PostgreSQL + Redis.

## Stack

- **Framework**: NestJS (Node.js + TypeScript)
- **Banco de dados**: PostgreSQL 16 (via TypeORM)
- **Cache / Filas**: Redis 7 + BullMQ
- **Autenticação**: JWT + Passport
- **Documentação**: Swagger (OpenAPI)
- **Storage**: MinIO
- **WhatsApp**: Evolution API
- **IA**: OpenAI / Anthropic Claude / Google Gemini (configurável por empresa)

## Pré-requisitos

- Node.js 18+
- Docker e Docker Compose
- npm ou yarn

## Subir tudo com um comando (recomendado)

O `docker-compose` já inclui **PostgreSQL + Redis + MinIO + a própria API** (com
seed automático do Diretor). Basta:

```bash
docker compose up --build -d
```

Isso sobe a API em `http://localhost:3001`, cria o usuário Diretor
(`srodrigo1946@gmail.com` / senha padrão `123456789`) e alguns leads de exemplo.
O frontend é o segundo passo (ver repositório `kayser-one-frontend`).

> **Primeiro acesso:** faça login com o e-mail do Diretor e a senha padrão `123456789`.
> O sistema exigirá a troca de senha no primeiro login.

## Desenvolvimento (sem Docker para a API)

```bash
npm install
cp .env.example .env          # ajuste se necessário
docker compose up -d postgres redis minio   # só a infraestrutura
npm run seed                  # Diretor + leads de exemplo
npm run start:dev
```

## API Docs

Após subir, acesse: http://localhost:3001/api/docs

## Módulos

| Módulo | Descrição |
|--------|-----------|
| `auth` | Autenticação JWT, login, troca de senha |
| `users` | Gestão de usuários com hierarquia |
| `leads` | CRM de leads, importação Excel |
| `lead-history` | Histórico/timeline automático do lead |
| `kanban` | Fluxo comercial configurável |
| `dashboard` | Métricas e relatórios |
| `conversations` | Conversas e mensagens (WhatsApp) |
| `whatsapp` | Evolution API + webhook + fluxo automático da IA |
| `ai` | Agente IA multi-provedor (Anthropic/OpenAI/Gemini) |
| `knowledge` | Base de conhecimento usada pela IA |
| `settings` | Configuração de IA e automações (Diretor) |
| `appointments` | Agenda de visitas/compromissos |
| `automation` | Follow-up automático (cron diário) |

## Hierarquia de permissões

```
Diretor → Superintendente → Gerente Geral → Gerente → Corretor
```

Cada nível visualiza apenas sua própria equipe e leads associados.

## WhatsApp (Evolution API)

Configure o webhook da Evolution API apontando para:

```
{BACKEND_URL}/api/v1/whatsapp/webhook
```

Mensagens recebidas são persistidas e, se a resposta automática estiver ativa
(Configurações → IA), a Kayser One AI responde usando o provedor e a base de
conhecimento configurados.

## IA multi-provedor

O provedor (Anthropic Claude / OpenAI / Google Gemini), o modelo e a API Key são
definidos pelo Diretor em **Configurações → IA** (ou via variáveis de ambiente como
fallback). A IA responde usando apenas a base de conhecimento autorizada.
