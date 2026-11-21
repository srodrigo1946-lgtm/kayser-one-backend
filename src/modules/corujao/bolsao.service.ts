import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User, UserRole } from "../users/user.entity";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";
import { PRAZO_BOLSAO_HORAS } from "../../common/prazo-bolsao";

/** Prazo da 1ª etapa (mostrado na tela); as outras etapas estão em PRAZO_BOLSAO_HORAS. */
export const BOLSAO_HORAS = PRAZO_BOLSAO_HORAS.primeiro_contato;

/** Só CORRETOR da casa pega (empresa parceira e inativo não) — Rodrigo 20/11. */
export const podePegarBolsao = (u: User) => !!u && u.role === UserRole.CORRETOR && u.active !== false && !u.empresaId;

/**
 * Bolsão: lead da SWAT parado 48h em Novo Lead / Primeiro contato sai da SWAT e vai
 * pro Bolsão — qualquer um do K1 pega (o 1º que clicar leva).
 */
@Injectable()
export class BolsaoService {
  private readonly logger = new Logger(BolsaoService.name);

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    private readonly history: LeadHistoryService
  ) {}

  /** De hora em hora: move pro Bolsão os SWAT parados 48h na 1ª etapa. */
  @Cron("5 * * * *", { timeZone: "America/Sao_Paulo" })
  async moverParados(): Promise<number> {
    // Prazo por etapa: 1º contato 48h, agendamento 7d, visita realizada 15d, pasta 30d.
    const casos = Object.entries(PRAZO_BOLSAO_HORAS)
      .map(([st, h]) => `WHEN '${st}' THEN ${Number(h)}`)
      .join(" ");
    const rows: { id: string }[] = await this.leadsRepo.query(
      `UPDATE leads SET bolsao = true, "bolsaoEm" = now(), swat = false
        WHERE swat = true AND bolsao = false AND status::text = ANY($1)
          AND COALESCE("etapaDesde", "createdAt") <= now() - (CASE status::text ${casos} END) * interval '1 hour'
      RETURNING id`,
      [Object.keys(PRAZO_BOLSAO_HORAS)]
    );
    const lista = Array.isArray(rows[0]) ? (rows[0] as any[]) : rows; // pg devolve [linhas, n] no UPDATE
    const ids = lista.map((r: any) => r.id).filter(Boolean);
    if (!ids.length) return 0;
    // Sai da fila SWAT (ninguém mais é chamado pra ele).
    await this.leadsRepo
      .query(`UPDATE lead_queue_assignments SET status = 'expirado' WHERE "leadId" = ANY($1) AND status IN ('aguardando','pendente')`, [ids])
      .catch(() => null);
    for (const id of ids) {
      await this.history
        .log({ leadId: id, type: LeadHistoryType.SISTEMA, description: `Bolsão: o relógio da etapa zerou (SWAT) — liberado pros corretores pegarem.` })
        .catch(() => {});
    }
    this.logger.log(`Bolsão: ${ids.length} lead(s) SWAT com o relógio zerado foram pro Bolsão.`);
    return ids.length;
  }

  /** Lista do Bolsão. Nome e telefone só depois de pegar (Diretor vê tudo). */
  async lista(user: User) {
    const ehDiretor = user.role === UserRole.DIRETOR;
    const leads = await this.leadsRepo.find({ where: { bolsao: true }, relations: ["responsavel"], order: { bolsaoEm: "ASC" }, take: 300 });
    return {
      podePegar: podePegarBolsao(user),
      horas: BOLSAO_HORAS,
      leads: leads.map((l) => ({
        id: l.id,
        empreendimento: l.empreendimento || "",
        origem: l.origem || "",
        campanha: l.campanha || "",
        desde: l.bolsaoEm,
        ...(ehDiretor ? { name: l.name, phone: l.phone || l.whatsapp || "", responsavel: l.responsavel?.name || "—" } : {}),
      })),
    };
  }

  /** Pega o lead: vira de quem clicou primeiro e entra em Primeiro contato. */
  async pegar(leadId: string, user: User) {
    if (!podePegarBolsao(user)) throw new ForbiddenException("Você não pode pegar leads do Bolsão.");
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead não encontrado.");
    const r = await this.leadsRepo
      .createQueryBuilder()
      .update(Lead)
      .set({ responsavelId: user.id, status: LeadStatus.PRIMEIRO_CONTATO, bolsao: false } as any)
      .where("id = :id", { id: leadId })
      .andWhere("bolsao = true")
      .execute();
    if (!r.affected) throw new ForbiddenException("Esse lead já foi pego por outra pessoa. Atualize a lista.");
    await this.convRepo.update({ leadId }, { assignedToId: user.id }).catch(() => {});
    await this.history
      .log({
        leadId,
        type: LeadHistoryType.SISTEMA,
        description: `Bolsão: pego por ${user.name} — entrou em Primeiro Contato.`,
        userId: user.id,
        fromStatus: lead.status,
        toStatus: LeadStatus.PRIMEIRO_CONTATO,
      })
      .catch(() => {});
    this.logger.log(`Bolsão: lead ${leadId} pego por ${user.name}.`);
    return { ok: true, leadId };
  }
}
