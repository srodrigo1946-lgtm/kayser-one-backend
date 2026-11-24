import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Cron } from "@nestjs/schedule";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User, UserRole } from "../users/user.entity";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";
import { PRAZO_BOLSAO_HORAS, FILA_NORMAL_DESDE, SLA_ANUNCIO_DESDE, LEAD_ANUNCIO_SQL } from "../../common/prazo-bolsao";
import { SettingsService } from "../settings/settings.service";

/** Prazo da 1ª etapa (mostrado na tela); as outras etapas estão em PRAZO_BOLSAO_HORAS. */
export const BOLSAO_HORAS = PRAZO_BOLSAO_HORAS.primeiro_contato;

/** Só CORRETOR da casa pega (empresa parceira e inativo não) — Rodrigo 20/11. */
export const podePegarBolsao = (u: User) => !!u && u.role === UserRole.CORRETOR && u.active !== false && !u.empresaId;

/**
 * Bloqueado no Bolsão: o próprio id está na lista OU algum chefe acima dele (gerente
 * bloqueado = time inteiro bloqueado). `chefeDe` = id → managerId.
 */
export function bloqueadoNoBolsao(userId: string, bloqueados: Set<string>, chefeDe: Map<string, string | null>): boolean {
  let atual: string | null | undefined = userId;
  for (let i = 0; atual && i < 20; i++) {
    if (bloqueados.has(atual)) return true;
    atual = chefeDe.get(atual) ?? null;
  }
  return false;
}

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
    private readonly history: LeadHistoryService,
    @InjectRepository(User) private readonly usersRepo?: Repository<User>,
    private readonly settings?: SettingsService
  ) {}

  private async listaBloqueados(): Promise<Set<string>> {
    const s: any = await this.settings?.get().catch(() => null);
    return new Set(String(s?.bolsaoBloqueados || "").split(",").map((x) => x.trim()).filter(Boolean));
  }

  /** Pode pegar = corretor da casa, ativo, e nem ele nem o gerente dele bloqueados pelo Diretor. */
  async podePegar(user: User): Promise<boolean> {
    if (!podePegarBolsao(user)) return false;
    const bloq = await this.listaBloqueados();
    if (!bloq.size || !this.usersRepo) return true;
    const todos = await this.usersRepo.find({ select: ["id", "managerId"] as any });
    return !bloqueadoNoBolsao(user.id, bloq, new Map(todos.map((u) => [u.id, (u as any).managerId ?? null])));
  }

  /** Diretor: gerentes e corretores da casa com o bloqueio de cada um. */
  async bloqueios() {
    const bloq = await this.listaBloqueados();
    const users = this.usersRepo ? await this.usersRepo.find({ where: { active: true } as any, order: { name: "ASC" } }) : [];
    const casa = users.filter((u) => !u.empresaId && u.role !== UserRole.DIRETOR);
    const chefeDe = new Map(users.map((u) => [u.id, (u as any).managerId ?? null]));
    const item = (u: User) => ({
      id: u.id,
      nome: u.name,
      bloqueado: bloq.has(u.id),
      // Bloqueado pelo gerente (time) — não por ele mesmo.
      pelaEquipe: !bloq.has(u.id) && bloqueadoNoBolsao(u.id, bloq, chefeDe),
    });
    return {
      gestores: casa.filter((u) => u.role !== UserRole.CORRETOR).map(item),
      corretores: casa.filter((u) => u.role === UserRole.CORRETOR).map(item),
    };
  }

  /** Diretor bloqueia/libera alguém de pegar no Bolsão. */
  async definirBloqueio(userId: string, bloqueado: boolean) {
    const bloq = await this.listaBloqueados();
    if (bloqueado) bloq.add(userId);
    else bloq.delete(userId);
    await this.settings?.update({ bolsaoBloqueados: [...bloq].join(",") || null } as any);
    return { ok: true, bloqueado };
  }

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
    // Fila NORMAL e TODOS os leads de anúncio (Facebook/Meta e Google Ads) — Rodrigo 23/11.
    // Relógio = maior entre: entrou na etapa, chegou pro corretor pela fila, início do SLA
    // (SLA_ANUNCIO_DESDE — histórico antigo não despenca). Pegou do Bolsão e parou de novo →
    // volta (24/11: o relógio vale sempre; ao pegar, etapaDesde recomeça).
    const rowsNormal: { id: string }[] = await this.leadsRepo.query(
      `UPDATE leads l SET bolsao = true, "bolsaoEm" = now()
         FROM (SELECT x.id, (SELECT MAX(a."assignedAt") FROM lead_queue_assignments a
                              WHERE a."leadId" = x.id AND a.swat = false AND a."assignedAt" >= $2) AS chegou
                 FROM leads x
                WHERE x.swat = false AND x.bolsao = false AND x.status::text = ANY($1)) c
        WHERE l.id = c.id
          AND (${LEAD_ANUNCIO_SQL} OR c.chegou IS NOT NULL)
          AND GREATEST(COALESCE(l."etapaDesde", l."createdAt"), COALESCE(c.chegou, $3::timestamptz), $3::timestamptz)
              <= now() - (CASE l.status::text ${casos} END) * interval '1 hour'
      RETURNING l.id`,
      [Object.keys(PRAZO_BOLSAO_HORAS), FILA_NORMAL_DESDE, SLA_ANUNCIO_DESDE]
    ).catch((e: any) => { this.logger.warn(`Bolsão fila normal/anúncio: ${e?.message}`); return []; });
    const lista = (Array.isArray(rows[0]) ? (rows[0] as any[]) : rows).concat(Array.isArray(rowsNormal[0]) ? (rowsNormal[0] as any[]) : rowsNormal); // pg devolve [linhas, n] no UPDATE
    const ids = lista.map((r: any) => r.id).filter(Boolean);
    if (!ids.length) return 0;
    // Sai da fila SWAT (ninguém mais é chamado pra ele).
    await this.leadsRepo
      .query(`UPDATE lead_queue_assignments SET status = 'expirado' WHERE "leadId" = ANY($1) AND status IN ('aguardando','pendente')`, [ids])
      .catch(() => null);
    for (const id of ids) {
      await this.history
        .log({ leadId: id, type: LeadHistoryType.SISTEMA, description: `Bolsão: o relógio da etapa zerou — liberado pros corretores pegarem.` })
        .catch(() => {});
    }
    this.logger.log(`Bolsão: ${ids.length} lead(s) com o relógio zerado foram pro Bolsão.`);
    return ids.length;
  }

  /** Lista do Bolsão. Nome e telefone só depois de pegar (Diretor vê tudo). */
  async lista(user: User) {
    const ehDiretor = user.role === UserRole.DIRETOR;
    const leads = await this.leadsRepo.find({ where: { bolsao: true }, relations: ["responsavel"], order: { bolsaoEm: "ASC" }, take: 300 });
    return {
      podePegar: await this.podePegar(user),
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
    if (!(await this.podePegar(user))) throw new ForbiddenException("Você não pode pegar leads do Bolsão (fale com o Diretor).");
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead não encontrado.");
    const r = await this.leadsRepo
      .createQueryBuilder()
      .update(Lead)
      // etapaDesde = agora: o relógio recomeça pra quem pegou (zerou de novo → volta pro Bolsão).
      .set({ responsavelId: user.id, status: LeadStatus.PRIMEIRO_CONTATO, bolsao: false, etapaDesde: () => "now()" } as any)
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
