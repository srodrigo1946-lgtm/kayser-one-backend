import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThan, Repository } from "typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User } from "../users/user.entity";

@Injectable()
export class LeadQueueService {
  private readonly logger = new Logger(LeadQueueService.name);

  constructor(
    @InjectRepository(LeadQueueSettings)
    private readonly settingsRepo: Repository<LeadQueueSettings>,
    @InjectRepository(LeadQueueAssignment)
    private readonly assignRepo: Repository<LeadQueueAssignment>,
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>
  ) {}

  /**
   * Membros do rodízio que REALMENTE existem e podem atender.
   * Usuário apagado (ou desativado/não aprovado) continuava no `memberIds` e
   * recebia leads que ninguém via — o lead sumia até o prazo estourar.
   * Aqui os fantasmas são removidos da fila de forma definitiva.
   */
  private async activeMembers(s: LeadQueueSettings): Promise<string[]> {
    const ids = s.memberIds ?? [];
    if (ids.length === 0) return [];
    const users = await this.usersRepo.find({ where: { id: In(ids) } });
    const validos = new Set(
      users.filter((u) => u.active !== false && u.approved !== false).map((u) => u.id)
    );
    const limpos = ids.filter((id) => validos.has(id));
    if (limpos.length !== ids.length) {
      const removidos = ids.filter((id) => !validos.has(id));
      this.logger.warn(
        `Fila: ${removidos.length} membro(s) inexistente(s)/inativo(s) removido(s) do rodízio.`
      );
      s.memberIds = limpos;
      s.pointer = 0;
      await this.settingsRepo.save(s);
    }
    return limpos;
  }

  /** Configuração única da fila (cria o singleton se ainda não existir). */
  async getSettings(): Promise<LeadQueueSettings> {
    let s = await this.settingsRepo.findOne({ where: {} });
    if (!s) {
      s = await this.settingsRepo.save(
        this.settingsRepo.create({ enabled: false, slaMinutes: 5, memberIds: [], pointer: 0 })
      );
    }
    return s;
  }

  async updateSettings(dto: { enabled?: boolean; slaMinutes?: number; memberIds?: string[] }) {
    const s = await this.getSettings();
    if (dto.enabled !== undefined) s.enabled = dto.enabled;
    if (dto.slaMinutes !== undefined) s.slaMinutes = Math.max(1, dto.slaMinutes);
    if (dto.memberIds !== undefined) {
      s.memberIds = dto.memberIds;
      s.pointer = 0;
    }
    return this.settingsRepo.save(s);
  }

  /** Atribui o lead ao próximo membro do rodízio. Null se desligada/sem membros. */
  async enqueueAdLead(input: {
    conversationId: string;
    leadId?: string;
  }): Promise<LeadQueueAssignment | null> {
    const s = await this.getSettings();
    const members = await this.activeMembers(s);
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
    await this.convRepo.update(input.conversationId, { assignedToId: userId });
    this.logger.log(`Lead de anúncio ${input.conversationId} atribuído a ${userId}.`);
    return saved;
  }

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
    if (expired.length === 0) return 0;

    const s = await this.getSettings();
    const members = await this.activeMembers(s);
    let count = 0;
    for (const a of expired) {
      a.status = "expirado";
      await this.assignRepo.save(a);
      if (!s.enabled || members.length === 0) continue;

      const cur = members.indexOf(a.assignedToId);
      const nextIdx = (((cur + 1) % members.length) + members.length) % members.length;
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
    if (count) this.logger.log(`Fila: ${count} lead(s) reatribuído(s) por SLA vencido.`);
    return count;
  }

  /** Métricas do dia (não expõe conteúdo das conversas). */
  async getBoard() {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
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
}
