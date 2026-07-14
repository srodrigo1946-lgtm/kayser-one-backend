# Módulo "Subir Pasta para Análise" — design (multi-fase)

**Data:** 2026-07-14 · **Status:** Em andamento (Fase 2 implementada)

## Objetivo
Aba "📂 Subir Pasta para Análise": o **corretor** cadastra cliente + empreendimento,
monta a **pasta** com documentos e envia a uma **empresa parceira** (correspondente
bancário) que **analisa e devolve o parecer** (✅ aprovado / ⚠️ complemento / ❌
inválido ou crédito reprovado). **Sem IA** — quem analisa é a empresa.

## Decisões aprovadas
- Fluxo conduzido pelo corretor; empresa parceira analisa (não IA).
- Empresa parceira acessa via **login próprio no CRM** (papel Analista/Empresa; vê só
  as pastas atribuídas; registra o parecer). Cadastro liberado pelo **Diretor**.
- Ordem de construção: **Fase 2 → 3 → 1**.
- Reaproveita: módulo `documents` (upload por fase simplificada/completa, CLT/
  empresário, Cloudflare R2), `Lead` (cliente), `Property` (empreendimento),
  `getScopeIds` (permissões).

## Fases
- **Fase 2 — Cadastro completo do cliente + CEP (FEITA):** `Lead` ganha `cpf`,
  `dataNascimento`, `estadoCivil`, `cep`, `logradouro`, `numero`, `complemento`,
  `bairro`, `estado` (+ `cidade`/`renda` já existiam). SchemaBootstrap cria colunas.
  Drawer do lead: seção "Cadastro completo (financiamento)" com **CEP automático via
  ViaCEP** (grátis, sem chave; preenche rua/bairro/cidade/estado, edição manual
  liberada).
- **Fase 3 — A Pasta + aba do módulo:** entidade Pasta (cliente + empreendimento com
  unidade/bloco/apto/valores + documentos + empresa atribuída + status), aba, barra de
  progresso (em análise → aprovado/reprovado/complemento).
- **Fase 1 — Empresa parceira:** cadastro (CNPJ + e-mail) + aprovação do Diretor +
  papel Analista/Empresa + acesso escopado às pastas atribuídas.
- (Depois) Fase 4 — ambiente da empresa analisar/devolver parecer + histórico; Fase 5
  — ciclo de storage 40 min → Cloudflare (cripto/logs).

## Verificação
Build (Railway/Vercel) + teste real do Rodrigo. Testes unitários adiados (disco cheio).
