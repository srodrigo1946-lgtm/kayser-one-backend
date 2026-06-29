# Imagem do backend Kayser One (NestJS)
FROM node:20-bookworm-slim

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
