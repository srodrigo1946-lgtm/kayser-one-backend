# Follow-up automático de 3 dias — regras por origem (design)

**Data:** 2026-07-13 · **Autor:** Rodrigo + Claude · **Status:** aprovado

## Objetivo
Escopar o follow-up automático de leads para disparar **só** em leads de **anúncio**
(Facebook/Instagram/outros) e leads **cadastrados manualmente pelos cargos** — excluindo
os que chegaram sozinhos no WhatsApp. Mensagem de saudação por horário, com o nome do lead.
Regras editáveis **só pelo Diretor**, com painel liga/desliga.

## Decisões (aprovadas)
- **Escopo:** origens `anuncio` + `manual` (exclui `whatsapp` orgânico). Configurável.
- **Mensagem:** saudação por horário + retomada, com `{nome}` (primeiro nome).
- **Painel (Diretor):** liga/desliga, dias (padrão 3), origens, e os 3 textos.

## Backend
### 1. Coluna `source` no lead
`leads.source`: `'anuncio' | 'manual' | 'whatsapp'` (default `manual`). Preenchida na criação:
- Anúncio (`conversations.setAdOrigin`) → `anuncio`
- Formulário do cargo (`leads.create` via POST /leads) → `manual`
- Auto-criado de conversa (`conversations.setEtiquetas`) → `whatsapp`

### 2. SchemaBootstrap (sem migrations, DB_SYNC=false)
Serviço `OnModuleInit` roda DDL idempotente:
- `ALTER TABLE leads ADD COLUMN IF NOT EXISTS source ... DEFAULT 'manual'`
- colunas novas de settings (abaixo) via `ADD COLUMN IF NOT EXISTS`
- backfill único: `source='anuncio'` p/ `origem` em {facebook,instagram,tiktok,meta ads,google ads};
  `source='whatsapp'` onde `name = phone`.

### 3. Settings (novos campos)
- `followupSources` (simple-array, default `anuncio,manual`)
- `followupMsgManha` / `followupMsgTarde` / `followupMsgNoite` (text; defaults no service se vazio)
- (já existem `followupEnabled`, `followupDays`)

### 4. AutomationService.runFollowup
- Query adiciona `source: In(settings.followupSources)`.
- Mensagem = template do horário (manhã <12, tarde <18, noite) com `{nome}` → primeiro nome.
- Mantém: corte `lastContactAt < hoje - dias`, exclui venda ganha/perdida, loga histórico.

### 5. API
- Update de Settings (já Diretor-only) aceita os novos campos.
- `POST /automation/followup/run` (Diretor) segue para teste manual.

## Frontend
Card "Follow-up automático" em Configurações, **visível só ao Diretor**: toggle, dias,
checkboxes de origem, 3 textareas (dica `{nome}`), botão Salvar.

## Testes
Unit: filtro por `source` + escolha do template por horário + troca de `{nome}`.

## Fora de escopo (YAGNI)
Relatório por origem, múltiplos follow-ups em sequência, agendamento por horário específico.
