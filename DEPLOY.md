# Deploy — Kayser One

Frontend na **Vercel** e backend na **Railway**. Os dois sobem direto do GitHub.

---

## 1) Backend na Railway

1. Acesse https://railway.app → **New Project** → **Deploy from GitHub repo** → escolha `kayser-one-backend`.
   - A Railway detecta o `Dockerfile`/`railway.json` e faz o build automaticamente.
2. No projeto, clique **+ New** → **Database** → **Add PostgreSQL**.
3. No serviço do backend, aba **Variables**, adicione:

   | Variável | Valor |
   |----------|-------|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (referência ao banco criado) |
   | `JWT_SECRET` | um segredo forte qualquer |
   | `SEED_DIRETOR_EMAIL` | `srodrigo1946@gmail.com` |
   | `SEED_DIRETOR_NAME` | `Rodrigo (Diretor)` |
   | `FRONTEND_URL` | a URL da Vercel (passo 2) — ex.: `https://kayser-one.vercel.app` |
   | `NODE_ENV` | `production` |

   > A API lê `PORT` automaticamente (a Railway injeta). O schema do banco é criado
   > sozinho no primeiro start (synchronize) e o Diretor é semeado automaticamente.
   >
   > **Redis e MinIO são opcionais** — a API sobe sem eles. Sem MinIO, a foto de
   > perfil é guardada no banco (fallback). Se quiser, adicione um Redis/MinIO depois.

4. Após o deploy, a Railway dá uma URL pública (ex.: `https://kayser-one-backend.up.railway.app`).
   Em **Settings → Networking → Generate Domain** se ainda não houver.
   - A API fica em `.../api/v1` e o Swagger em `.../api/docs`.

---

## 2) Frontend na Vercel

1. Acesse https://vercel.com → **Add New… → Project** → importe `kayser-one-frontend`.
   - A Vercel detecta o Next.js automaticamente (sem config extra).
2. Em **Environment Variables**, adicione:

   | Variável | Valor |
   |----------|-------|
   | `NEXT_PUBLIC_API_URL` | `https://SEU-BACKEND.up.railway.app/api/v1` (URL da Railway + `/api/v1`) |

3. **Deploy**. A Vercel dá a URL pública (ex.: `https://kayser-one.vercel.app`).
4. Volte na Railway e confirme que `FRONTEND_URL` é exatamente essa URL da Vercel (para o CORS liberar).

---

## Pronto
- App: a URL da Vercel → login `srodrigo1946@gmail.com` / senha `123456789` (troca obrigatória no 1º acesso).
- Para a IA responder, configure a chave do provedor em **Configurações → IA** (ou via env `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/`GOOGLE_AI_API_KEY` na Railway).
