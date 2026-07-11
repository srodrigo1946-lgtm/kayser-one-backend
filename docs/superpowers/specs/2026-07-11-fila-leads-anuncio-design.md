# Fila de Leads de Anúncio (Clique-para-WhatsApp) — Design

Data: 2026-07-11
Projeto: Kayser One (CRM imobiliário)

## 1. Objetivo

Captar leads de anúncios (Facebook, Instagram, TikTok) do tipo **"Clique para WhatsApp"**
(sem formulário — mais barato) e distribuí-los entre os cargos por uma **fila em rodízio**
com **SLA de tempo de atendimento**, opcional e gerida apenas pelo Diretor.

## 2. Fora de escopo (YAGNI, por agora)

- Página/landing de formulário público.
- Integração nativa do Facebook Lead Ads (webhook do Meta / Instant Forms).
- Distribuição ponderada, por região ou por desempenho.
- Só o rodízio simples com SLA é implementado.

## 3. Como o lead entra

1. O anúncio "Clique para WhatsApp" abre uma conversa no WhatsApp com um número da
   empresa. A conversa chega no CRM pelo webhook da Evolution (fluxo já existente).
2. A mensagem de entrada de um anúncio traz **dados de referência (referral)** do Meta:
   plataforma de origem e informações da campanha. O parser da Evolution
   (`parseEvolutionMessage`) passa a extrair esses campos quando presentes.
3. Ao criar/vincular o lead e a conversa, o sistema grava automaticamente:
   - `lead.origem`: `facebook` | `instagram` | `tiktok` (ou `whatsapp` quando não é anúncio).
   - `lead.campanha`: nome/id da campanha, quando disponível.
   - `conversation.fromAd`: booleano marcando que a conversa nasceu de anúncio.
4. Na UI, conversas/leads de anúncio recebem um selo **"🎯 Anúncio"**.

## 4. Dois modos de operação

- **Sem fila (padrão):** cada cargo roda o próprio anúncio, que aponta para o WhatsApp
  dele. O lead cai direto no número do cargo (roteamento por dono da instância, já
  implementado). Nenhuma distribuição acontece.
- **Com fila (opcional):** o Diretor liga a fila. O anúncio da fila aponta para o
  **número central** (ver seção 5) e os leads que chegam por ele são distribuídos em
  rodízio (seção 6).

O botão de ligar/desligar a fila é visível/acionável **somente pelo Diretor**.

## 5. Número central

- É o **número de WhatsApp do Diretor** (uma instância `user_<idDoDiretor>`), conectado
  normalmente pelo QR. O anúncio da fila aponta para ele.
- Leads que chegam no número central e são de anúncio entram na fila para distribuição.
- Quando um lead é distribuído, a conversa é **atribuída ao cargo** (`assignedToId`), e o
  cargo responde pelo CRM — o envio sai pela instância do **número central** (não pela do
  cargo), porque é nesse número que o cliente está conversando.
  - Ajuste necessário no envio: quando a conversa tem um `instanceOwnerId` (o dono do
    número que recebeu, aqui o Diretor), o `sendManual` usa a instância desse dono, e não
    a `user_<idDoRemetente>`. Assim qualquer cargo atribuído responde pelo número central.

## 6. Regras da fila (rodízio + SLA)

- **Rodízio simples:** os cargos participantes têm uma ordem definida pelo Diretor. Cada
  novo lead de anúncio é atribuído ao próximo da ordem (A → B → C → volta A). Um
  **ponteiro** (índice do último atribuído) é persistido para continuar de onde parou.
- **SLA de atendimento (padrão 5 min, configurável pelo Diretor):** ao ser atribuído, o
  cargo tem 5 minutos para **atender** (seção 7). Se não atender no prazo, o lead é
  **reatribuído automaticamente ao próximo** da fila, e o novo prazo recomeça.
- O ciclo se repete pela ordem. Se todos passarem sem atender, o lead volta ao topo (o
  Diretor vê no painel os que "estouraram" e pode intervir).
- Notificação: ao receber um lead da fila, o cargo é avisado (sino/notificação do CRM):
  "Novo lead de anúncio — você tem 5 min para atender."

## 7. Detecção de "atendido"

- Um lead é considerado **atendido** quando o cargo atribuído envia a **primeira mensagem
  de resposta** naquela conversa (mensagem `out` originada por aquele cargo) dentro do
  prazo. Ao atender, o SLA para e o lead permanece com ele.
- Alternativa manual: um botão "Assumir" na conversa também marca como atendido (útil se o
  cargo quer segurar o lead antes de responder).

## 8. Tela de gestão — aba "Fila de Leads" (somente Diretor)

- **Ligar/Desligar** a fila (botão principal).
- **Participantes e ordem:** lista dos cargos na fila, com arrastar-para-ordenar e
  adicionar/remover. Qualquer usuário aprovado (superintendente, gerente geral, gerente,
  corretor) pode ser incluído.
- **SLA:** campo do tempo de atendimento em minutos (padrão 5).
- **Painel do dia:** leads recebidos, para quem foram atribuídos, quantos foram atendidos
  no prazo e quantos "estouraram" e foram repassados.

## 9. Modelo de dados

Nova tabela `lead_queue_settings` (linha única, singleton por empresa):
- `enabled: boolean` (padrão false)
- `slaMinutes: int` (padrão 5)
- `memberIds: uuid[]` (ordem do rodízio; jsonb/simple-array)
- `pointer: int` (índice do último atribuído no rodízio)

Nova tabela `lead_queue_assignment` (rastreia cada distribuição, para SLA e painel):
- `id, conversationId, leadId, assignedToId`
- `assignedAt: Date`, `dueAt: Date` (assignedAt + SLA)
- `status: 'pendente' | 'atendido' | 'expirado'`
- `attempts: int` (quantos cargos já passaram)

Reaproveitados: `lead.origem`, `lead.campanha`. Novo campo `conversation.fromAd: boolean`.

> Observação: `DB_SYNC=false` em produção. As novas tabelas/colunas exigem um flip
> temporário `DB_SYNC=true → deploy → false` (procedimento já conhecido).

## 10. Componentes / arquitetura

- **`LeadQueueService`** (novo módulo `lead-queue`): decide o próximo da fila, cria a
  atribuição, reatribui no timeout, marca atendido. Interface clara:
  `enqueueAdLead(conversation)`, `markAttended(conversationId, userId)`,
  `getSettings()`, `updateSettings(dto)`.
- **SLA worker:** um `@Cron` (a cada ~30s) que busca atribuições `pendente` com `dueAt`
  vencido e chama a reatribuição. (Usa o `@nestjs/schedule`, já presente.)
- **Integração no fluxo do WhatsApp:** em `handleInbound`, quando a conversa é de anúncio
  (`fromAd`), o número que recebeu é o central e a fila está ligada, chamar
  `LeadQueueService.enqueueAdLead(...)` em vez do roteamento por dono.
- **Detecção de atendimento:** em `addMessage` (direção `out`), se há atribuição pendente
  para a conversa e o remetente é o cargo atribuído, chamar `markAttended`.
- **Controller `LeadQueueController`** (protegido; ações de escrita só Diretor):
  `GET/PUT /lead-queue/settings`, `GET /lead-queue/board`,
  `POST /conversations/:id/assumir` (marcar atendido manualmente).
- **Frontend:** aba "Fila de Leads" (Diretor); selo "🎯 Anúncio" nas conversas/leads;
  notificação de novo lead com contador de tempo.

## 11. Interação com a privacidade do WhatsApp

- Regra existente: cada usuário só vê as **próprias** conversas (Diretor inclusive).
- Os leads da fila chegam no número central (Diretor), mas são **imediatamente atribuídos
  a um cargo** (`assignedToId`), então saem da visão do Diretor e entram só na do cargo
  atribuído — coerente com a privacidade.
- A aba "Fila de Leads" e o painel mostram **metadados** (quem recebeu, horários, status),
  **não** o conteúdo das conversas dos cargos.

## 12. Testes

- Unit: rodízio avança na ordem e o ponteiro persiste; reatribuição ao vencer o SLA;
  `markAttended` para o SLA; parser extrai origem/campanha do referral.
- Integração: conversa de anúncio no número central com fila ligada → atribui ao próximo;
  sem resposta em 5 min → vai pro próximo; resposta do cargo atribuído → atendido.
- Escopo/privacidade: cargo não-atribuído não acessa a conversa (403); Diretor não vê
  conversas já distribuídas.

## 13. Riscos / pontos em aberto

- **Dados de referral da Evolution:** confirmar em produção que a Evolution repassa os
  campos de anúncio (nem toda versão/derivação expõe o `contextInfo`/referral). Se não
  vier, o lead ainda entra, mas sem `origem/campanha` automáticos (marca como `whatsapp`).
- **Envio pelo número central:** garantir que o `sendManual` use a instância do número
  central quando a conversa é da fila (senão o cargo responderia pelo número dele).
- **Concorrência:** duas mensagens quase simultâneas não devem furar o ponteiro do
  rodízio (usar atualização atômica/lock leve na configuração).
