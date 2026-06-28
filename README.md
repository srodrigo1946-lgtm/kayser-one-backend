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

## Instalação

```bash
# Instalar dependências
npm install

# Copiar variáveis de ambiente
cp .env.example .env
# Editar .env com suas configurações

# Subir infraestrutura (PostgreSQL + Redis + MinIO)
docker-compose up -d

# Criar o usuário Diretor inicial (+ leads de exemplo)
# Email definido em SEED_DIRETOR_EMAIL (.env) — senha padrão: 123456789
npm run seed

# Rodar em desenvolvimento
npm run start:dev
```

> **Primeiro acesso:** faça login com o e-mail do Diretor e a senha padrão `123456789`.
> O sistema exigirá a troca de senha no primeiro login.

## API Docs

Após subir, acesse: http://localhost:3001/api/docs

## Módulos

| Módulo | Descrição |
|--------|-----------|
| `auth` | Autenticação JWT, login, troca de senha |
| `users` | Gestão de usuários com hierarquia |
| `leads` | CRM de leads, importação Excel |
| `kanban` | Fluxo comercial configurável |
| `dashboard` | Métricas e relatórios |
| `whatsapp` | Integração Evolution API |
| `ai` | Agente IA, base de conhecimento, automações |

## Hierarquia de permissões

```
Diretor → Superintendente → Gerente Geral → Gerente → Corretor
```

Cada nível visualiza apenas sua própria equipe e leads associados.
