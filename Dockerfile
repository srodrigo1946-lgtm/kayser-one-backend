# Imagem do backend Kayser One (NestJS)
FROM node:20-bookworm-slim

# pg_dump (client 16) para o backup diário do banco. Usa o repositório oficial
# do PostgreSQL para garantir versão compatível com o servidor do Railway.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] http://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependências primeiro (melhor cache)
COPY package*.json ./
RUN npm install

# Código + build
COPY . .
RUN npm run build

EXPOSE 3001

# Roda o seed (idempotente) e sobe a API.
# O seed só cria dados se ainda não existirem, então é seguro a cada start.
CMD ["sh", "-c", "npm run seed || true; node dist/main"]
