# Fase 5 — Janela de 40 minutos + arquivamento seguro

## Contexto
Módulo "Subir Pasta para Análise". Hoje os documentos do cliente sobem direto para o
Cloudflare R2 (permanente) e a empresa parceira os acessa a qualquer momento via
`GET /pastas/:id/files`. Falta a **janela de exposição limitada**: a empresa deve ver os
documentos por apenas 40 minutos após liberação; depois o acesso fecha e os arquivos
ficam guardados com segurança (só corretor/Diretor acessam).

## Decisões (com o Rodrigo)
- A janela controla o **acesso online da EMPRESA** (baixar/visualizar). Corretor/Diretor
  sempre acessam (é o "buscar do arquivo").
- **O relógio começa quando o corretor/Diretor LIBERA** (botão "Liberar (40 min)"),
  não quando a empresa abre.
- Passados 40 min: empresa é **bloqueada** (403) e vê "arquivado com segurança". Os bytes
  **não se movem** — já estão no R2/Cloudflare criptografado; o que fecha é a porta de acesso.
- **Sem job em segundo plano**: a janela é verificada **na hora do acesso** (comparando o
  horário). Simples e à prova de falha.
- **Pendências pelo mesmo link**: quando a empresa aponta pendência (status Complemento +
  parecer), o cliente reenvia pelo mesmo `/docs/[token]`. Depois o corretor clica em
  "Liberar (40 min)" de novo (o botão reabre a janela). Reabrir = novo `docsReleasedAt`.

## Backend
- `Pasta.docsReleasedAt: timestamp | null` (+ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` no SchemaBootstrap).
- `WINDOW_MS = 40*60*1000`. Helper `windowInfo(pasta)` → `{ released, active, archived, remainingMs, releasedAt, expiresAt }`.
- `listFiles`: empresa só recebe a lista de arquivos se `active`; senão devolve `documents: []` + `window`.
- `getFile`: empresa com janela não-ativa → `ForbiddenException`. Corretor/Diretor sempre.
- `releaseDocs(id, user)`: seta `docsReleasedAt = now`. Empresa não pode liberar (`Forbidden`). `POST /pastas/:id/release`.

## Frontend
- `PastaWindow` no `use-pastas`; `usePastaFiles` devolve `window`; `useReleasePastaDocs`.
- `DocsViewer`: banner de estado + cronômetro ao vivo (setInterval 1s).
  - Empresa: "aguardando liberação" (âmbar) / "disponível por mais MM:SS" (verde) / "expirada — arquivado" (vermelho, lista escondida).
  - Corretor/Diretor: status da janela + botão "Liberar (40 min)" / "Reabrir (40 min)".

## Fora de escopo (agora)
- Mover fisicamente o objeto no R2 para `arquivo/` (não muda a segurança; o controle é por acesso).
- Notificar a empresa (não há canal p/ a empresa hoje).
- Testes unitários (disco cheio).
