# Sincronizar Responsável do lead ↔ Atendente da conversa

**Data:** 2026-07-14
**Autor:** Rodrigo (Diretor) + Claude
**Status:** Aprovado

## Problema

Hoje o **Responsável** de um lead (aba Leads) e o **Atendente** da conversa de
WhatsApp são independentes. Transferir um lead para outro corretor NÃO move a
conversa dele, e vice-versa — os dois ficam inconsistentes (ex.: lead
`5521983529930` com "teste corretor", mas a conversa com "Rodrigo Kayser").

## Objetivo

Manter os dois **sincronizados nos dois sentidos**, daqui pra frente ("transferir"
move lead + conversa juntos). Sem tocar nos dados já existentes.

## Design

Sincronização **no backend**, nos métodos que já existem, escrevendo direto no
registro do outro lado (sem chamar o método do outro serviço → sem loop):

- **`LeadsService.update`**: se o `responsavelId` **mudou**, atualiza o
  `assignedToId` da(s) conversa(s) vinculada(s) por `leadId`.
- **`ConversationsService.assign`**: após mudar o `assignedToId`, se a conversa
  tem `leadId`, atualiza o `responsavelId` do lead.

### Casos de borda
- Lead sem conversa → só atualiza o lead.
- Conversa sem lead → só atualiza a conversa.
- Valor vazio ("Sem responsável") → **espelha** (limpar de um lado limpa do outro).
- `LeadsService.update` só sincroniza quando `responsavelId` realmente muda (não em
  edição de nome/telefone/etc.).

### Dependências / módulos
- Injetar `Repository<Conversation>` no `LeadsService`
  (`LeadsModule` → `TypeOrmModule.forFeature([..., Conversation])`).
- `ConversationsService` já injeta `Repository<Lead>` (`leadsRepo`).
- Sem dependência circular entre serviços (ambos usam repositórios, não o serviço
  do outro).

### Permissões
Inalteradas. O `responsavelId`/`userId` já é validado por escopo de equipe antes do
espelhamento, então escrever o mesmo valor no outro lado é seguro.

### Frontend
Nenhuma mudança de lógica. A outra tela reflete o novo dono ao recarregar/navegar.

## Testes
Unitários dos dois sentidos + bordas: lead com conversa, lead sem conversa,
conversa com lead, conversa sem lead, troca real vs. não-troca, e propagação de
vazio.

## Verificação
Build do Railway (compilação) + teste end-to-end pelo Rodrigo: trocar Responsável
num lead que tem conversa → o Atendente muda; e o inverso.
