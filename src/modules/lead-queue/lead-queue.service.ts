import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, LessThan, Repository } from "typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User, UserRole } from "../users/user.entity";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { EscalaService } from "../escala/escala.service";
import { ConversationsService } from "../conversations/conversations.service";

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
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly escala: EscalaService,
    private readonly conversations: ConversationsService
  ) {}

  /**
   * Atribuir na fila tem que refletir NO LEAD também: antes só a conversa
   * ganhava atendente, e a lista de Leads mostrava "Responsável —" — parecia
   * que a fila não tinha distribuído nada.
   */
  private async atribuir(conversationId: string, leadId: string | undefined, userId: string) {
    await this.convRepo.update(conversationId, { assignedToId: userId });
    if (leadId) await this.leadsRepo.update(leadId, { responsavelId: userId });
  }

  /**
   * Filtra ids mantendo só quem pode atender: ativo + aprovado + CORRETOR.
   * Regra do Rodrigo: gerente pra cima NÃO entra no rodízio, só corretor.
   * Empresa parceira (corretor + empresaId) também fica de fora.
   */
  private async filtrarAtivos(ids: string[]): Promise<string[]> {
    if (!ids || ids.length === 0) return [];
    const users = await this.usersRepo.find({ where: { id: In(ids) } });
    const validos = new Set(
      users
        .filter(
          (u) =>
            u.active !== false &&
            u.approved !== false &&
            u.role === UserRole.CORRETOR &&
            !u.empresaId
        )
        .map((u) => u.id)
    );
    return ids.filter((id) => validos.has(id));
  }

  /** Atendentes de plantão AGORA = turno ativo ∩ usuários válidos. Vazio fora de plantão. */
  private async atendentesDoTurno(now = new Date()): Promise<string[]> {
    const turno = await this.escala.turnoAtivo(now);
    return turno ? this.filtrarAtivos(turno.atendenteIds) : [];
  }

  /** Próximo do rodízio (avança o ponteiro em `s`; caller salva `s`). */
  private proximo(s: LeadQueueSettings, membros: string[]): string {
    const idx = ((s.pointer % membros.length) + membros.length) % membros.length;
    s.pointer = (idx + 1) % membros.length;
    return membros[idx];
  }

  private prazo(s: LeadQueueSettings): Date {
    return new Date(Date.now() + s.slaMinutes * 60_000);
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

  /**
   * Enfileira um lead (anúncio ou formulário). Distribui entre os atendentes do
   * turno ativo; se ninguém está de plantão, fica `aguardando` o próximo turno
   * (assignedToId "" = sem dono). Null se a fila estiver desligada.
   */
  async enqueueLead(input: {
    conversationId: string;
    leadId?: string;
  }): Promise<LeadQueueAssignment | null> {
    const s = await this.getSettings();
    if (!s.enabled) return null;

    const membros = await this.atendentesDoTurno();
    if (membros.length === 0) {
      this.logger.log(`Lead ${input.conversationId} sem plantão ativo → aguardando próximo turno.`);
      return this.assignRepo.save(
        this.assignRepo.create({
          conversationId: input.conversationId,
          leadId: input.leadId,
          assignedToId: "",
          dueAt: new Date(),
          status: "aguardando",
          attempts: 0,
        })
      );
    }

    const userId = this.proximo(s, membros);
    await this.settingsRepo.save(s);
    const saved = await this.assignRepo.save(
      this.assignRepo.create({
        conversationId: input.conversationId,
        leadId: input.leadId,
        assignedToId: userId,
        dueAt: this.prazo(s),
        status: "pendente",
        attempts: 1,
      })
    );
    await this.atribuir(input.conversationId, input.leadId, userId);
    this.logger.log(`Lead ${input.conversationId} atribuído a ${userId} (plantão).`);
    return saved;
  }

  /**
   * Joga um lead cadastrado MANUALMENTE no rodízio: cria/acha a conversa pelo
   * telefone e enfileira (mesma máquina do anúncio/Meta). Diretor dispara pelo
   * painel do lead. Devolve um status pra UI mostrar o que aconteceu.
   */
  async distribuirLeadManual(
    leadId: string
  ): Promise<{ status: "distribuido" | "aguardando" | "ja_na_fila" | "sem_telefone" | "fila_desligada"; assignedToId?: string }> {
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead não encontrado.");

    const s = await this.getSettings();
    if (!s.enabled) return { status: "fila_desligada" };

    const phone = (lead.phone || lead.whatsapp || "").replace(/\D/g, "");
    if (!phone) return { status: "sem_telefone" };

    const conv = await this.conversations.findOrCreateByPhone(phone);
    if (!conv.leadId) await this.conversations.setLead(conv.id, lead.id, lead.name);

    // Já tem atribuição em aberto? Não duplica (evita clique repetido / lead de anúncio).
    const aberta = await this.assignRepo.findOne({
      where: [
        { conversationId: conv.id, status: "pendente" },
        { conversationId: conv.id, status: "aguardando" },
      ],
    });
    if (aberta) return { status: aberta.status as any, assignedToId: aberta.assignedToId || undefined };

    const a = await this.enqueueLead({ conversationId: conv.id, leadId: lead.id });
    if (!a) return { status: "fila_desligada" };
    return {
      status: a.status === "aguardando" ? "aguardando" : "distribuido",
      assignedToId: a.assignedToId || undefined,
    };
  }

  /** Distribui os leads `aguardando` quando um turno abre. Roda a cada minuto. */
  @Cron(CronExpression.EVERY_MINUTE)
  async liberarAguardando(): Promise<number> {
    const s = await this.getSettings();
    if (!s.enabled) return 0;
    const membros = await this.atendentesDoTurno();
    if (membros.length === 0) return 0;

    const espera = await this.assignRepo.find({
      where: { status: "aguardando" },
      order: { assignedAt: "ASC" },
    });
    let count = 0;
    for (const a of espera) {
      const userId = this.proximo(s, membros);
      a.status = "pendente";
      a.assignedToId = userId;
      a.attempts = 1;
      a.dueAt = this.prazo(s);
      await this.assignRepo.save(a);
      await this.atribuir(a.conversationId, a.leadId, userId);
      count++;
    }
    await this.settingsRepo.save(s);
    if (count) this.logger.log(`Fila: ${count} lead(s) aguardando distribuído(s) no início do turno.`);
    return count;
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
    if (!s.enabled) return 0;
    const membros = await this.atendentesDoTurno();
    let count = 0;
    for (const a of expired) {
      // Se o corretor JÁ AGIU (moveu do "Novo Lead" p/ Primeiro Contato ou além),
      // o timer encerra e o lead NÃO passa pro próximo — só anda se ficou "Novo Lead".
      if (a.leadId) {
        const lead = await this.leadsRepo.findOne({ where: { id: a.leadId } });
        if (lead && lead.status !== LeadStatus.NOVO_LEAD) {
          a.status = "atendido";
          await this.assignRepo.save(a);
          continue;
        }
      }
      // Turno fechou: volta a aguardar o próximo (não se perde nem gira sozinho).
      if (membros.length === 0) {
        a.status = "aguardando";
        a.assignedToId = "";
        await this.assignRepo.save(a);
        continue;
      }
      a.status = "expirado";
      await this.assignRepo.save(a);

      const cur = membros.indexOf(a.assignedToId);
      const nextIdx = (((cur + 1) % membros.length) + membros.length) % membros.length;
      const nextUser = membros[nextIdx];
      const next = this.assignRepo.create({
        conversationId: a.conversationId,
        leadId: a.leadId,
        assignedToId: nextUser,
        dueAt: this.prazo(s),
        status: "pendente",
        attempts: a.attempts + 1,
      });
      await this.assignRepo.save(next);
      await this.atribuir(a.conversationId, a.leadId, nextUser);
      count++;
    }
    if (count) this.logger.log(`Fila: ${count} lead(s) reatribuído(s) por SLA (plantão).`);
    return count;
  }

  /** Atribuições pendentes (leadId + prazo) — para o relógio de contagem no card. */
  async getPendentes(): Promise<{ leadId: string; dueAt: Date }[]> {
    const rows = await this.assignRepo.find({ where: { status: "pendente" } });
    return rows
      .filter((r) => !!r.leadId)
      .map((r) => ({ leadId: r.leadId as string, dueAt: r.dueAt }));
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
