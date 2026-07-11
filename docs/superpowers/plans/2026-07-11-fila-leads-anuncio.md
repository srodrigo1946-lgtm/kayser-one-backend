# Fila de Leads de Anúncio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Captar leads de anúncios "Clique-para-WhatsApp" (FB/IG/TikTok) e distribuí-los entre os cargos por rodízio simples com SLA de 5 min (configurável pelo Diretor).

**Architecture:** Reaproveita o fluxo WhatsApp/Evolution existente. Um `LeadQueueService` decide o próximo da fila e cria uma "atribuição" com prazo; um `@Cron` reatribui quem estoura o SLA; a resposta do cargo marca como atendido. Configuração e painel numa aba só do Diretor. O número central é o WhatsApp do Diretor.

**Tech Stack:** NestJS, TypeORM, @nestjs/schedule (já presente), Jest; frontend Next.js + React Query.

## Global Constraints

- Produção usa `DB_SYNC=false`: novas tabelas/colunas exigem flip `DB_SYNC=true → deploy → false` (Task 7).
- Deploy: `git push` na `main` (Railway backend, Vercel frontend).
- Privacidade existente: cada usuário só vê as próprias conversas (`conversations.service.list`/`assertCanAccess`). Não quebrar.
- Cargos (enum `UserRole`): `diretor`, `superintendente`, `gerente_geral`, `gerente`, `corretor`.
- Instância WhatsApp por usuário: `user_<id>` (ver `whatsapp.controller.ts`).
- Mensagens em português; seguir estilo dos módulos existentes.

---

### Task 1: Entidades e módulo da fila + coluna `fromAd`

**Files:**
- Create: `backend/src/modules/lead-queue/lead-queue-settings.entity.ts`
- Create: `backend/src/modules/lead-queue/lead-queue-assignment.entity.ts`
- Create: `backend/src/modules/lead-queue/lead-queue.module.ts`
- Modify: `backend/src/modules/conversations/conversation.entity.ts` (add `fromAd`)
- Modify: `backend/src/app.module.ts` (registrar `LeadQueueModule`)

**Interfaces:**
- Produces: `LeadQueueSettings { id, enabled: boolean, slaMinutes: number, memberIds: string[], pointer: number }`
- Produces: `LeadQueueAssignment { id, conversationId, leadId, assignedToId, assignedAt: Date, dueAt: Date, status: 'pendente'|'atendido'|'expirado', attempts: number }`
- Produces: `Conversation.fromAd: boolean`

- [ ] **Step 1: Criar `lead-queue-settings.entity.ts`**

```ts
import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity("lead_queue_settings")
export class LeadQueueSettings {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: "int", default: 5 })
  slaMinutes: number;

  // Ordem do rodízio (ids de usuários). simple-array = coluna text separada por vírgula.
  @Column({ type: "simple-array", nullable: true })
  memberIds: string[];

  @Column({ type: "int", default: 0 })
  pointer: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

- [ ] **Step 2: Criar `lead-queue-assignment.entity.ts`**

```ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

export type AssignmentStatus = "pendente" | "atendido" | "expirado";

@Entity("lead_queue_assignments")
export class LeadQueueAssignment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  conversationId: string;

  @Column({ nullable: true })
  leadId: string;

  @Column()
  assignedToId: string;

  @CreateDateColumn()
  assignedAt: Date;

  @Index()
  @Column()
  dueAt: Date;

  @Column({ default: "pendente" })
  status: AssignmentStatus;

  @Column({ type: "int", default: 1 })
  attempts: number;
}
```

- [ ] **Step 3: Adicionar `fromAd` em `conversation.entity.ts`**

Localizar a classe `Conversation` e adicionar (perto de `etiquetas`):

```ts
  @Column({ default: false })
  fromAd: boolean;
```

- [ ] **Step 4: Criar `lead-queue.module.ts`**

```ts
import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";
import { Conversation } from "../conversations/conversation.entity";
import { LeadQueueService } from "./lead-queue.service";
import { LeadQueueController } from "./lead-queue.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadQueueSettings, LeadQueueAssignment, Conversation]),
    UsersModule,
  ],
  providers: [LeadQueueService],
  controllers: [LeadQueueController],
  exports: [LeadQueueService],
})
export class LeadQueueModule {}
```

> Nota: `LeadQueueService` e `LeadQueueController` são criados nas Tasks 2/6; para compilar agora, crie stubs vazios (`export class LeadQueueService {}` / controller vazio) e complete depois, OU ordene a implementação começando pela Task 2 antes de importar. Recomendado: criar os arquivos com o conteúdo das Tasks 2 e 6 antes de finalizar o build.

- [ ] **Step 5: Registrar no `app.module.ts`**

Adicionar o import e incluir `LeadQueueModule` no array `imports` (ao lado de `BackupModule`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/lead-queue backend/src/modules/conversations/conversation.entity.ts backend/src/app.module.ts
git commit -m "feat(fila): entidades de settings/assignment + coluna fromAd + módulo"
```

---

### Task 2: Rodízio, configurações e enfileiramento (TDD)

**Files:**
- Create: `backend/src/modules/lead-queue/lead-queue.service.ts`
- Test: `backend/src/modules/lead-queue/lead-queue.service.spec.ts`

**Interfaces:**
- Consumes: entidades da Task 1; `UsersService`.
- Produces:
  - `getSettings(): Promise<LeadQueueSettings>` (cria singleton se não existir)
  - `updateSettings(dto: { enabled?: boolean; slaMinutes?: number; memberIds?: string[] }): Promise<LeadQueueSettings>`
  - `enqueueAdLead(input: { conversationId: string; leadId?: string }): Promise<LeadQueueAssignment | null>` (atribui ao próximo membro; null se fila desligada ou sem membros)
  - `private nextMemberId(settings): { userId: string; pointer: number } | null`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { Test } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { LeadQueueService } from "./lead-queue.service";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";

function repoMock(initial: any = null) {
  let store = initial;
  return {
    findOne: jest.fn(async () => store),
    find: jest.fn(async () => (Array.isArray(store) ? store : [])),
    create: jest.fn((v) => v),
    save: jest.fn(async (v) => { store = v; return v; }),
  };
}

describe("LeadQueueService (rodízio)", () => {
  it("enqueueAdLead atribui ao próximo e avança o ponteiro", async () => {
    const settings = { id: "s1", enabled: true, slaMinutes: 5, memberIds: ["A", "B", "C"], pointer: 0 };
    const settingsRepo = repoMock(settings);
    const assignRepo = repoMock([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadQueueService,
        { provide: getRepositoryToken(LeadQueueSettings), useValue: settingsRepo },
        { provide: getRepositoryToken(LeadQueueAssignment), useValue: assignRepo },
        { provide: getRepositoryToken(require("../conversations/conversation.entity").Conversation), useValue: repoMock(null) },
      ],
    }).compile();
    const svc = moduleRef.get(LeadQueueService);

    const a1 = await svc.enqueueAdLead({ conversationId: "c1" });
    expect(a1?.assignedToId).toBe("A");
    expect(settings.pointer).toBe(1);
  });

  it("enqueueAdLead retorna null quando a fila está desligada", async () => {
    const settingsRepo = repoMock({ id: "s1", enabled: false, slaMinutes: 5, memberIds: ["A"], pointer: 0 });
    const assignRepo = repoMock([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        LeadQueueService,
        { provide: getRepositoryToken(LeadQueueSettings), useValue: settingsRepo },
        { provide: getRepositoryToken(LeadQueueAssignment), useValue: assignRepo },
        { provide: getRepositoryToken(require("../conversations/conversation.entity").Conversation), useValue: repoMock(null) },
      ],
    }).compile();
    const svc = moduleRef.get(LeadQueueService);
    expect(await svc.enqueueAdLead({ conversationId: "c1" })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest lead-queue.service -t "rodízio"`
Expected: FAIL (LeadQueueService não implementado / método ausente).

- [ ] **Step 3: Implementar `lead-queue.service.ts` (mínimo p/ passar)**

```ts
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";
import { Conversation } from "../conversations/conversation.entity";

@Injectable()
export class LeadQueueService {
  constructor(
    @InjectRepository(LeadQueueSettings)
    private readonly settingsRepo: Repository<LeadQueueSettings>,
    @InjectRepository(LeadQueueAssignment)
    private readonly assignRepo: Repository<LeadQueueAssignment>,
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>
  ) {}

  async getSettings(): Promise<LeadQueueSettings> {
    let s = await this.settingsRepo.findOne({ where: {} });
    if (!s) s = await this.settingsRepo.save(this.settingsRepo.create({ enabled: false, slaMinutes: 5, memberIds: [], pointer: 0 }));
    return s;
  }

  async updateSettings(dto: { enabled?: boolean; slaMinutes?: number; memberIds?: string[] }) {
    const s = await this.getSettings();
    if (dto.enabled !== undefined) s.enabled = dto.enabled;
    if (dto.slaMinutes !== undefined) s.slaMinutes = Math.max(1, dto.slaMinutes);
    if (dto.memberIds !== undefined) { s.memberIds = dto.memberIds; s.pointer = 0; }
    return this.settingsRepo.save(s);
  }

  /** Atribui o lead ao próximo membro da fila. Null se desligada/sem membros. */
  async enqueueAdLead(input: { conversationId: string; leadId?: string }): Promise<LeadQueueAssignment | null> {
    const s = await this.getSettings();
    const members = s.memberIds ?? [];
    if (!s.enabled || members.length === 0) return null;

    const idx = ((s.pointer % members.length) + members.length) % members.length;
    const userId = members[idx];
    s.pointer = (idx + 1) % members.length;
    await this.settingsRepo.save(s);

    const dueAt = new Date(Date.now() + s.slaMinutes * 60_000);
    const assignment = this.assignRepo.create({
      conversationId: input.conversationId,
      leadId: input.leadId,
      assignedToId: userId,
      dueAt,
      status: "pendente",
      attempts: 1,
    });
    const saved = await this.assignRepo.save(assignment);
    // Atribui a conversa ao cargo (visibilidade por dono).
    await this.convRepo.update(input.conversationId, { assignedToId: userId });
    return saved;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npx jest lead-queue.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/lead-queue/lead-queue.service.ts backend/src/modules/lead-queue/lead-queue.service.spec.ts
git commit -m "feat(fila): serviço de rodízio + settings + enqueue (TDD)"
```

---

### Task 3: SLA — reatribuição por timeout + marcar atendido (TDD)

**Files:**
- Modify: `backend/src/modules/lead-queue/lead-queue.service.ts`
- Modify: `backend/src/modules/lead-queue/lead-queue.service.spec.ts`

**Interfaces:**
- Produces:
  - `markAttended(conversationId: string, userId: string): Promise<boolean>` (true se marcou)
  - `reassignExpired(): Promise<number>` (quantidade reatribuída)
  - `@Cron` a cada 30s chamando `reassignExpired`

- [ ] **Step 1: Escrever os testes que falham**

```ts
it("markAttended encerra o SLA quando o cargo atribuído responde", async () => {
  const settingsRepo = repoMock({ id: "s1", enabled: true, slaMinutes: 5, memberIds: ["A", "B"], pointer: 0 });
  const pending = { id: "as1", conversationId: "c1", assignedToId: "A", status: "pendente", dueAt: new Date(Date.now() + 60000), attempts: 1 };
  const assignRepo = repoMock([pending]);
  assignRepo.findOne = jest.fn(async () => pending);
  const moduleRef = await Test.createTestingModule({
    providers: [
      LeadQueueService,
      { provide: getRepositoryToken(LeadQueueSettings), useValue: settingsRepo },
      { provide: getRepositoryToken(LeadQueueAssignment), useValue: assignRepo },
      { provide: getRepositoryToken(require("../conversations/conversation.entity").Conversation), useValue: repoMock(null) },
    ],
  }).compile();
  const svc = moduleRef.get(LeadQueueService);
  expect(await svc.markAttended("c1", "A")).toBe(true);
  expect(pending.status).toBe("atendido");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest lead-queue.service -t "markAttended"`
Expected: FAIL (método não existe).

- [ ] **Step 3: Implementar `markAttended` e `reassignExpired`**

Adicionar imports no topo: `import { Cron, CronExpression } from "@nestjs/schedule";` e `import { LessThan } from "typeorm";`

```ts
  /** Marca a atribuição pendente como atendida quando o cargo atribuído responde. */
  async markAttended(conversationId: string, userId: string): Promise<boolean> {
    const a = await this.assignRepo.findOne({ where: { conversationId, status: "pendente" } });
    if (!a || a.assignedToId !== userId) return false;
    a.status = "atendido";
    await this.assignRepo.save(a);
    return true;
  }

  /** Reatribui ao próximo da fila as atribuições pendentes com prazo vencido. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async reassignExpired(): Promise<number> {
    const expired = await this.assignRepo.find({
      where: { status: "pendente", dueAt: LessThan(new Date()) },
    });
    const s = await this.getSettings();
    const members = s.memberIds ?? [];
    let count = 0;
    for (const a of expired) {
      a.status = "expirado";
      await this.assignRepo.save(a);
      if (!s.enabled || members.length === 0) continue;
      // Próximo da ordem a partir de quem estava atribuído.
      const cur = members.indexOf(a.assignedToId);
      const nextIdx = ((cur + 1) % members.length + members.length) % members.length;
      const nextUser = members[nextIdx];
      const next = this.assignRepo.create({
        conversationId: a.conversationId,
        leadId: a.leadId,
        assignedToId: nextUser,
        dueAt: new Date(Date.now() + s.slaMinutes * 60_000),
        status: "pendente",
        attempts: a.attempts + 1,
      });
      await this.assignRepo.save(next);
      await this.convRepo.update(a.conversationId, { assignedToId: nextUser });
      count++;
    }
    return count;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npx jest lead-queue.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/lead-queue/lead-queue.service.ts backend/src/modules/lead-queue/lead-queue.service.spec.ts
git commit -m "feat(fila): SLA com reatribuição por timeout + markAttended (TDD)"
```

---

### Task 4: Detecção de anúncio (referral → origem/campanha + fromAd) (TDD)

**Files:**
- Modify: `backend/src/modules/whatsapp/whatsapp-flow.service.ts`
- Modify: `backend/src/modules/whatsapp/whatsapp-flow.service.spec.ts`

**Interfaces:**
- `parseEvolutionMessage` passa a retornar `ad?: { platform: 'facebook'|'instagram'|'tiktok'; campaign?: string }` quando a mensagem tem referral do Meta.

- [ ] **Step 1: Escrever o teste que falha**

O referral do Meta vem em `message.extendedTextMessage.contextInfo` (ou `msg.contextInfo`) com `externalAdReply`/`sourceType`. Teste:

```ts
it("parseEvolutionMessage extrai origem do anúncio (referral)", () => {
  const svc: any = new WhatsappFlowService({} as any, {} as any, {} as any, {} as any, {} as any);
  const payload = {
    instance: "user_diretor",
    data: {
      key: { remoteJid: "5521999999999@s.whatsapp.net", fromMe: false },
      pushName: "Cliente",
      message: {
        conversation: "Oi, vim do anúncio",
        contextInfo: { externalAdReply: { sourceType: "ad", sourceApp: "instagram", title: "Campanha Verão" } },
      },
    },
  };
  const parsed = svc.parseEvolutionMessage(payload);
  expect(parsed.ad?.platform).toBe("instagram");
  expect(parsed.ad?.campaign).toBe("Campanha Verão");
});
```

> Ajustar o construtor do teste ao número de dependências real de `WhatsappFlowService` (hoje: conversations, settings, ai, whatsapp; na Task 5 entra `leadQueue`). Passar mocks vazios equivalentes.

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd backend && npx jest whatsapp-flow -t "referral"`
Expected: FAIL.

- [ ] **Step 3: Implementar a extração do referral**

Em `parseEvolutionMessage`, após montar `message`, adicionar:

```ts
    // Anúncio "Clique para WhatsApp": o Meta manda o referral no contextInfo.
    const ctx = (message as any).extendedTextMessage?.contextInfo || (msg as any).contextInfo;
    const ext = ctx?.externalAdReply;
    let ad: { platform: "facebook" | "instagram" | "tiktok"; campaign?: string } | undefined;
    if (ext) {
      const app = String(ext.sourceApp || ext.sourceType || "").toLowerCase();
      const platform = app.includes("insta") ? "instagram" : app.includes("tiktok") ? "tiktok" : "facebook";
      ad = { platform, campaign: ext.title || ext.sourceId || undefined };
    }
```

E incluir `ad` no objeto retornado por `parseEvolutionMessage` (adicionar `ad` ao tipo de retorno e ao `return { ... }`).

- [ ] **Step 4: Rodar e ver passar**

Run: `cd backend && npx jest whatsapp-flow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/whatsapp/whatsapp-flow.service.ts backend/src/modules/whatsapp/whatsapp-flow.service.spec.ts
git commit -m "feat(fila): extrair origem/campanha do anúncio (referral do Meta)"
```

---

### Task 5: Integrar fila no fluxo de entrada + atendimento + envio pelo número central

**Files:**
- Modify: `backend/src/modules/whatsapp/whatsapp-flow.service.ts` (handleInbound + sendManual)
- Modify: `backend/src/modules/whatsapp/whatsapp.module.ts` (importar `LeadQueueModule`)
- Modify: `backend/src/modules/conversations/conversations.service.ts` (addMessage → markAttended; expor `fromAd`)
- Modify: `backend/src/modules/conversations/conversations.module.ts` (importar `LeadQueueModule`)

**Interfaces:**
- Consumes: `LeadQueueService.enqueueAdLead`, `LeadQueueService.markAttended`, `LeadQueueService.getSettings`.

- [ ] **Step 1: Injetar `LeadQueueService` e enfileirar no `handleInbound`**

Importar `LeadQueueModule` em `whatsapp.module.ts`. Injetar `private readonly leadQueue: LeadQueueService` no `WhatsappFlowService`.

No `handleInbound`, após `findOrCreateByPhone` e `setContactInfo`, adicionar:

```ts
      // Anúncio: marca origem/campanha e, se a fila do Diretor estiver ligada e o
      // número que recebeu for o central (Diretor), distribui em rodízio.
      if (parsed.ad) {
        conv.fromAd = true;
        await this.conversations.setAdOrigin(conv.id, parsed.ad.platform, parsed.ad.campaign, conv.leadId);
        const settings = await this.leadQueue.getSettings();
        const central = settings.memberIds && receivingUserId && `user_${receivingUserId}`; // dono central
        if (settings.enabled && receivingUserId && this.isCentral(receivingUserId, settings)) {
          await this.leadQueue.enqueueAdLead({ conversationId: conv.id, leadId: conv.leadId });
        }
      }
```

> Simplificação recomendada: o "número central" é o do Diretor. Guardar `centralUserId` em `LeadQueueSettings` (adicionar coluna `centralUserId: string` na Task 1 se preferir explicitar) OU derivar: o número central é aquele configurado como dono da fila. Para o MVP, tratar como central qualquer instância cujo dono seja o Diretor. Implementar `isCentral(userId, settings)` consultando o papel do usuário via `UsersService.findById(userId)` e checando `role === 'diretor'`.

- [ ] **Step 2: Implementar `setAdOrigin` em `conversations.service.ts`**

```ts
  /** Marca a conversa/lead como originada de anúncio (origem + campanha). */
  async setAdOrigin(conversationId: string, platform: string, campaign: string | undefined, leadId?: string) {
    await this.convRepo.update(conversationId, { fromAd: true });
    if (leadId) await this.leadsRepo.update(leadId, { origem: platform, campanha: campaign ?? null });
  }
```

- [ ] **Step 3: Detectar atendimento no `addMessage`**

Injetar `LeadQueueService` em `ConversationsService` (importar `LeadQueueModule` em `conversations.module.ts`). No `addMessage`, quando `direction === "out"` e não é IA, chamar (best-effort):

```ts
    if (direction === "out" && !isAI) {
      const conv0 = await this.convRepo.findOne({ where: { id: conversationId } });
      if (conv0?.assignedToId) {
        await this.leadQueue.markAttended(conversationId, conv0.assignedToId).catch(() => {});
      }
    }
```

> Observação de ciclo de dependência: `ConversationsService` importar `LeadQueueService` e `LeadQueueService` importar `Conversation` (repo, não o service) evita ciclo. Se houver ciclo de módulos, usar `forwardRef` no import do módulo.

- [ ] **Step 4: Envio pelo número central (sendManual)**

Em `sendManual(instanceName, remoteJid, text)`: quando a conversa é da fila (`fromAd` + atribuição existente), o `instanceName` deve ser o do número central (Diretor), não o do cargo. Ajuste no `WhatsappController.sendMessage`/`flowService.sendManual`: descobrir o dono correto a partir da conversa.

```ts
  // Em WhatsappFlowService.sendManual, aceitar a conversa e escolher a instância:
  async sendManual(senderUserId: string, remoteJid: string, text: string) {
    const conv = await this.conversations.findOrCreateByPhone(remoteJid);
    // Conversa de anúncio na fila responde pelo número central (Diretor).
    const instanceOwner = conv.fromAd ? await this.conversations.getCentralOwnerId() : senderUserId;
    const instanceName = `user_${instanceOwner}`;
    await this.conversations.addMessage(conv.id, text, "out", false);
    return this.whatsapp.sendText(instanceName, remoteJid, text);
  }
```

E `getCentralOwnerId()` em `conversations.service.ts` retorna o id do Diretor (via `UsersService`, primeiro usuário `role='diretor'` aprovado).

> Atualizar `WhatsappController.sendMessage` para passar `req.user.id` como `senderUserId`.

- [ ] **Step 5: Build local + testes**

Run: `cd backend && npm run build && npx jest`
Expected: build sem erros; testes passam.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/whatsapp backend/src/modules/conversations
git commit -m "feat(fila): integrar rodízio no inbound, atendimento e envio pelo número central"
```

---

### Task 6: Controller da fila + guard do Diretor

**Files:**
- Create: `backend/src/modules/lead-queue/lead-queue.controller.ts`
- Create: `backend/src/modules/auth/guards/diretor.guard.ts` (se não existir um RolesGuard)
- Modify: `backend/src/modules/conversations/conversations.controller.ts` (`POST :id/assumir`)

**Interfaces:**
- `GET /lead-queue/settings` (autenticado) → settings
- `PUT /lead-queue/settings` (só Diretor) → atualiza
- `GET /lead-queue/board` (só Diretor) → { hoje: { recebidos, atendidos, expirados, porCargo: [...] } }
- `POST /conversations/:id/assumir` (autenticado) → `leadQueue.markAttended(id, req.user.id)`

- [ ] **Step 1: Criar `diretor.guard.ts`**

```ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";

@Injectable()
export class DiretorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (req.user?.role !== "diretor") throw new ForbiddenException("Apenas o Diretor pode alterar a fila.");
    return true;
  }
}
```

- [ ] **Step 2: Criar `lead-queue.controller.ts`**

```ts
import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsInt, IsOptional, Min } from "class-validator";
import { LeadQueueService } from "./lead-queue.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DiretorGuard } from "../auth/guards/diretor.guard";

class UpdateQueueDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) slaMinutes?: number;
  @IsOptional() @IsArray() memberIds?: string[];
}

@ApiTags("Fila de Leads")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("lead-queue")
export class LeadQueueController {
  constructor(private readonly queue: LeadQueueService) {}

  @Get("settings")
  @ApiOperation({ summary: "Configuração atual da fila" })
  getSettings() {
    return this.queue.getSettings();
  }

  @Put("settings")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Atualizar a fila (só Diretor)" })
  update(@Body() dto: UpdateQueueDto) {
    return this.queue.updateSettings(dto);
  }

  @Get("board")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Painel do dia (só Diretor)" })
  board() {
    return this.queue.getBoard();
  }
}
```

- [ ] **Step 3: Implementar `getBoard()` em `lead-queue.service.ts`**

```ts
  /** Métricas do dia (não expõe conteúdo das conversas). */
  async getBoard() {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const list = await this.assignRepo
      .createQueryBuilder("a")
      .where("a.assignedAt >= :since", { since })
      .getMany();
    const recebidos = new Set(list.map((a) => a.conversationId)).size;
    const atendidos = list.filter((a) => a.status === "atendido").length;
    const expirados = list.filter((a) => a.status === "expirado").length;
    const porCargo: Record<string, number> = {};
    for (const a of list) porCargo[a.assignedToId] = (porCargo[a.assignedToId] || 0) + 1;
    return { recebidos, atendidos, expirados, porCargo };
  }
```

- [ ] **Step 4: `POST /conversations/:id/assumir`**

Em `conversations.controller.ts` adicionar (injetando `LeadQueueService` no controller ou delegando ao service):

```ts
  @Post(":id/assumir")
  @ApiOperation({ summary: "Assumir/atender um lead da fila" })
  assumir(@Param("id") id: string, @Request() req: any) {
    return this.conversationsService.assumir(id, req.user);
  }
```

E `assumir(id, user)` em `conversations.service.ts` valida acesso (`assertCanAccess`) e chama `leadQueue.markAttended(id, user.id)`.

- [ ] **Step 5: Build local**

Run: `cd backend && npm run build`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/lead-queue backend/src/modules/auth/guards/diretor.guard.ts backend/src/modules/conversations
git commit -m "feat(fila): controller + guard Diretor + rota assumir"
```

---

### Task 7: Deploy backend + flip do DB_SYNC (novas tabelas/colunas)

**Files:** nenhum (operação de deploy).

- [ ] **Step 1: Push da main**

```bash
git push origin main
```

- [ ] **Step 2: Aguardar deploy ACTIVE** (Railway).

- [ ] **Step 3: Flip `DB_SYNC=true` → Deploy → verificar → `DB_SYNC=false`**

Via painel do Railway (variável `DB_SYNC`): true → Implantar → confirmar `/api/docs` 200 e `GET /api/v1/lead-queue/settings` responder 200/401 (tabela existe) → voltar `DB_SYNC=false` → Implantar. Cria `lead_queue_settings`, `lead_queue_assignments` e a coluna `conversations.fromAd`.

- [ ] **Step 4: Verificação**

Run:
```bash
base=https://kayser-one-backend-production.up.railway.app
curl -s -o /dev/null -w "%{http_code}\n" "$base/api/v1/lead-queue/settings"   # 401 = existe e exige login
```

---

### Task 8: Frontend — aba "Fila de Leads" (só Diretor)

**Files:**
- Create: `frontend/src/hooks/use-lead-queue.ts`
- Create: `frontend/src/app/(dashboard)/fila-leads/page.tsx`
- Modify: sidebar/navegação (mostrar o item só para `role === 'diretor'`)

**Interfaces:**
- `useQueueSettings()`, `useUpdateQueue()`, `useQueueBoard()` (React Query em `/lead-queue/*`).

- [ ] **Step 1: Criar `use-lead-queue.ts`**

```ts
"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface QueueSettings { id: string; enabled: boolean; slaMinutes: number; memberIds: string[]; pointer: number }

export function useQueueSettings() {
  return useQuery({ queryKey: ["lead-queue"], queryFn: async () => (await api.get<QueueSettings>("/lead-queue/settings")).data });
}
export function useUpdateQueue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dto: Partial<QueueSettings>) => (await api.put("/lead-queue/settings", dto)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lead-queue"] }),
  });
}
export function useQueueBoard() {
  return useQuery({ queryKey: ["lead-queue", "board"], queryFn: async () => (await api.get("/lead-queue/board")).data });
}
```

- [ ] **Step 2: Criar a página `fila-leads/page.tsx`**

Conteúdo: toggle "Ligar fila" (usa `useUpdateQueue({ enabled })`); input SLA (min); lista de cargos com selecionar/ordenar (usa `useUsers()` já existente para listar cargos aprovados e `memberIds` para ordem); botão salvar; painel do dia (`useQueueBoard`: recebidos/atendidos/expirados + por cargo). Seguir o estilo (glassmorphism/teal) das outras páginas. Restringir acesso a `role === 'diretor'` (redirecionar/ocultar caso contrário).

- [ ] **Step 3: Item na navegação só para Diretor**

No componente de sidebar, condicionar o link "Fila de Leads" a `user.role === "diretor"`.

- [ ] **Step 4: Build local**

Run: `cd frontend && npx tsc --noEmit` (ou `npm run build`)
Expected: sem erros.

- [ ] **Step 5: Commit + push**

```bash
git add frontend/src/hooks/use-lead-queue.ts "frontend/src/app/(dashboard)/fila-leads" frontend/src/components  # sidebar
git commit -m "feat(fila): aba Fila de Leads (Diretor) — settings + painel"
git push origin main
```

---

### Task 9: Frontend — selo "🎯 Anúncio" + notificação de novo lead

**Files:**
- Modify: `frontend/src/hooks/use-conversations.ts` (expor `fromAd` em `ConversationItem`)
- Modify: `frontend/src/app/(dashboard)/whatsapp/page.tsx` (selo na lista de conversas + botão "Assumir")

**Interfaces:**
- `ConversationItem.fromAd?: boolean`.

- [ ] **Step 1: Expor `fromAd` no hook**

Adicionar `fromAd?: boolean` em `ConversationItem` em `use-conversations.ts`.

- [ ] **Step 2: Selo na lista de conversas**

Na lista de conversas (whatsapp/page.tsx), quando `conv.fromAd`, renderizar um selo `🎯 Anúncio` ao lado do nome do contato.

- [ ] **Step 3: Botão "Assumir" na conversa de anúncio pendente**

No cabeçalho da conversa aberta, se `fromAd`, mostrar botão "Assumir" que chama `POST /conversations/:id/assumir` e invalida `["conversations"]`.

- [ ] **Step 4: Build local + push**

```bash
cd frontend && npx tsc --noEmit
git add frontend/src/hooks/use-conversations.ts "frontend/src/app/(dashboard)/whatsapp/page.tsx"
git commit -m "feat(fila): selo Anúncio + botão Assumir na conversa"
git push origin main
```

---

## Verificação final (end-to-end)

1. Diretor liga a fila, adiciona 2 cargos na ordem, SLA 1 min (para testar rápido).
2. Enviar uma mensagem simulando anúncio para o número do Diretor (payload com `externalAdReply`).
3. Conferir: conversa marcada `fromAd`, `origem` preenchida, atribuída ao 1º cargo.
4. Não responder por 1 min → reatribuída ao 2º cargo (checar via `board`).
5. 2º cargo responde → `markAttended` (status atendido; some do rodízio).
6. Privacidade: cargo não-atribuído recebe 403 ao abrir a conversa.
7. Voltar SLA para 5 min.
