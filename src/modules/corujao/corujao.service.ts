import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { In, Not, Repository } from "typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User, UserRole } from "../users/user.entity";
import { KanbanColumnEntity } from "../kanban/kanban-column.entity";
import { SettingsService } from "../settings/settings.service";
import { Settings } from "../settings/settings.entity";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";

/**
 * Corujão = repique automático dos leads "sem interesse" (coluna do Kanban) + dos
 * leads que ficaram com o Diretor. Os leads viram um "pool" que os corretores
 * ATIVADOS para o Corujão veem numa aba e ACEITAM (aceitou a sugestão → o lead é
 * dele e volta pro fluxo). Roda sozinho num horário (padrão 14h, Brasília) e tem
 * botão "Puxar e enviar" (avisa os corretores ativados por e-mail).
 */
@Injectable()
export class CorujaoService {
  private readonly logger = new Logger(CorujaoService.name);

  constructor(
    @InjectRepository(Lead) private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(User) private readonly usersRepo: Repository<User>,
    @InjectRepository(KanbanColumnEntity) private readonly columnsRepo: Repository<KanbanColumnEntity>,
    private readonly settings: SettingsService,
    private readonly history: LeadHistoryService,
    private readonly config: ConfigService
  ) {}

  private async diretorId(): Promise<string | null> {
    const d = await this.usersRepo.findOne({ where: { role: UserRole.DIRETOR }, order: { createdAt: "ASC" } });
    return d?.id ?? null;
  }

  /** Colunas-fonte do repique: a configurada, ou (fallback) a que se chama "sem interesse". */
  private async statusesAlvo(s: Settings): Promise<string[]> {
    if (s.corujaoStatus) return [s.corujaoStatus];
    const cols = await this.columnsRepo.find();
    return cols.filter((c) => /sem\s*interesse/i.test(c.title || "")).map((c) => c.key);
  }

  /**
   * WHERE dos leads elegíveis ao repique (coluna sem interesse + leads do Diretor).
   * `liberado` filtra pelo flag corujaoLiberado (true = já no pool; false = na fila
   * esperando o Diretor liberar; undefined = todos os elegíveis).
   */
  private async eligibleWhere(s: Settings, liberado?: boolean): Promise<any[]> {
    const statuses = await this.statusesAlvo(s);
    const extra = liberado === undefined ? {} : { corujaoLiberado: liberado };
    const where: any[] = [];
    if (statuses.length) where.push({ status: In(statuses), ...extra });
    if (s.corujaoIncluirDiretor) {
      const did = await this.diretorId();
      if (did) {
        where.push({
          responsavelId: did,
          status: Not(In([LeadStatus.VENDA_GANHA, LeadStatus.VENDA_PERDIDA])),
          ...extra,
        });
      }
    }
    return where;
  }

  /** Leads JÁ liberados no pool (o que os corretores veem/pegam). */
  private async poolLeads(): Promise<Lead[]> {
    const s = await this.settings.get();
    const where = await this.eligibleWhere(s, true);
    if (!where.length) return [];
    return this.leadsRepo.find({
      where,
      relations: ["responsavel"],
      order: { updatedAt: "ASC" },
      take: 300,
    });
  }

  /** Contagens: quantos já estão no pool e quantos ainda faltam liberar. */
  private async contagens(): Promise<{ noPool: number; naoLiberados: number }> {
    const s = await this.settings.get();
    const [wLib, wNao] = [await this.eligibleWhere(s, true), await this.eligibleWhere(s, false)];
    const noPool = wLib.length ? await this.leadsRepo.count({ where: wLib }) : 0;
    const naoLiberados = wNao.length ? await this.leadsRepo.count({ where: wNao }) : 0;
    return { noPool, naoLiberados };
  }

  /** Diretor libera N leads (os mais antigos) da fila pro pool do repique. */
  async liberar(qtd: number): Promise<{ released: number; noPool: number; naoLiberados: number }> {
    const s = await this.settings.get();
    const n = Math.max(1, Math.min(200, Math.floor(Number(qtd) || 0)));
    const where = await this.eligibleWhere(s, false);
    let released = 0;
    if (where.length) {
      const cand = await this.leadsRepo.find({ where, order: { updatedAt: "ASC" }, take: n });
      if (cand.length) {
        await this.leadsRepo.update({ id: In(cand.map((c) => c.id)) }, { corujaoLiberado: true });
        released = cand.length;
      }
    }
    const c = await this.contagens();
    return { released, ...c };
  }

  /** Diretor tira do pool os leads liberados (voltam pra fila; corretor deixa de ver). */
  async removerDoPool(): Promise<{ removidos: number; noPool: number; naoLiberados: number }> {
    const s = await this.settings.get();
    const where = await this.eligibleWhere(s, true);
    let removidos = 0;
    if (where.length) {
      const cur = await this.leadsRepo.find({ where, take: 1000 });
      if (cur.length) {
        await this.leadsRepo.update({ id: In(cur.map((c) => c.id)) }, { corujaoLiberado: false });
        removidos = cur.length;
      }
    }
    const c = await this.contagens();
    return { removidos, ...c };
  }

  /** Só corretor ATIVADO no Corujão pode PEGAR (aceitar) os leads do repique. */
  private podePegar(user: User): boolean {
    return user.role === UserRole.CORRETOR && user.corujao === true;
  }

  /**
   * Lista do repique para a aba Corujão. TODOS os cargos VEEM (monitoramento);
   * só corretor ativado PEGA (`podePegar`). O dono atual só o Diretor vê.
   */
  async getPool(user: User) {
    const leads = await this.poolLeads();
    const ehDiretor = user.role === UserRole.DIRETOR;
    return {
      podePegar: this.podePegar(user),
      leads: leads.map((l) => ({
        id: l.id,
        empreendimento: l.empreendimento || "",
        origem: l.origem || "",
        status: l.status,
        // Nome, telefone e dono atual só pro Diretor. Corretor/gerente veem só que
        // HÁ lead disponível (empreendimento/origem) e só descobrem quem é depois
        // de ACEITAR — aí o lead vira dele e aparece normal no CRM.
        ...(ehDiretor
          ? { name: l.name, phone: l.phone || l.whatsapp || "", responsavel: l.responsavel?.name || "—" }
          : {}),
      })),
    };
  }

  /** Corretor ativado aceita a sugestão: o lead vira dele e volta para "Novo Lead". */
  async aceitar(leadId: string, user: User) {
    if (!this.podePegar(user)) {
      throw new ForbiddenException("Só corretores ativados no Corujão podem pegar leads.");
    }
    const lead = await this.leadsRepo.findOne({ where: { id: leadId } });
    if (!lead) throw new NotFoundException("Lead não encontrado.");

    lead.responsavelId = user.id;
    (lead as any).responsavel = undefined; // solta a relação p/ o FK novo valer (GOTCHA TypeORM)
    lead.status = LeadStatus.NOVO_LEAD;
    await this.leadsRepo.save(lead);
    // Sincroniza o atendente da conversa vinculada (se houver).
    await this.convRepo.update({ leadId: lead.id }, { assignedToId: user.id }).catch(() => {});
    await this.history
      .log({
        leadId: lead.id,
        type: LeadHistoryType.SISTEMA,
        description: `Repique Corujão: aceito por ${user.name} — voltou para Novo Lead.`,
        userId: user.id,
      })
      .catch(() => {});
    return { ok: true, leadId: lead.id };
  }

  /** Corretores ativados no Corujão (ativos e aprovados). */
  private async corretoresAtivados(): Promise<User[]> {
    return this.usersRepo.find({
      where: { corujao: true, active: true, approved: true, role: UserRole.CORRETOR },
    });
  }

  /** Avisa por e-mail os corretores ativados que tem lead no repique (best-effort). */
  private async avisarCorretores(qtd: number, corretores: User[]) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    const destinos = corretores.map((c) => c.email).filter((e): e is string => !!e);
    if (!apiKey || destinos.length === 0 || qtd === 0) return 0;
    const from = this.config.get<string>("SUPPORT_FROM", "Kayser One <onboarding@resend.dev>");
    const html = `
      <div style="font-family:Arial,sans-serif">
        <h2>🦉 Corujão — ${qtd} lead(s) para repescar!</h2>
        <p>Tem ${qtd} lead(s) no Corujão esperando quem pega. Entre e clique em <b>Aceitar</b> nos que quiser.</p>
        <p><a href="https://www.kayserone.com.br/corujao">Abrir o Corujão</a></p>
      </div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: destinos, subject: `🦉 Corujão: ${qtd} leads para pegar`, html }),
    })
      .then((r) => {
        if (!r.ok) this.logger.warn(`Resend (corujão) falhou (${r.status})`);
      })
      .catch((err) => this.logger.warn(`Corujão e-mail: ${(err as Error).message}`));
    return destinos.length;
  }

  /** Puxa os leads do repique e avisa os corretores ativados. Botão do Diretor + cron. */
  async puxarEnviar(): Promise<{ leads: number; corretores: number; notificados: number }> {
    const leads = await this.poolLeads();
    const corretores = await this.corretoresAtivados();
    const notificados = await this.avisarCorretores(leads.length, corretores);
    this.logger.log(`Corujão: ${leads.length} lead(s), ${corretores.length} corretor(es) ativado(s).`);
    return { leads: leads.length, corretores: corretores.length, notificados };
  }

  /** Config + estado para a aba (Diretor). */
  async getConfig() {
    const s = await this.settings.get();
    const [cols, corretores, cont] = await Promise.all([
      this.columnsRepo.find({ order: { position: "ASC" } }),
      this.usersRepo.find({ where: { role: UserRole.CORRETOR, active: true }, order: { name: "ASC" } }),
      this.contagens(),
    ]);
    return {
      enabled: s.corujaoEnabled,
      hora: s.corujaoHora,
      status: s.corujaoStatus || (await this.statusesAlvo(s))[0] || "",
      incluirDiretor: s.corujaoIncluirDiretor,
      colunas: cols.map((c) => ({ key: c.key, title: c.title })),
      corretores: corretores
        .filter((c) => !c.empresaId)
        .map((c) => ({ id: c.id, name: c.name, corujao: !!c.corujao })),
      poolCount: cont.noPool,
      naoLiberados: cont.naoLiberados,
      autoQtd: s.corujaoAutoQtd ?? 0,
      agendadoPara: s.corujaoAgendadoPara ?? null,
    };
  }

  async setConfig(dto: {
    enabled?: boolean;
    hora?: string;
    status?: string;
    incluirDiretor?: boolean;
    autoQtd?: number;
    agendadoPara?: string | null;
  }) {
    const patch: Partial<Settings> = {};
    if (dto.enabled !== undefined) patch.corujaoEnabled = dto.enabled;
    if (dto.hora !== undefined && /^\d{1,2}:\d{2}$/.test(dto.hora)) patch.corujaoHora = dto.hora;
    if (dto.status !== undefined) patch.corujaoStatus = dto.status;
    if (dto.incluirDiretor !== undefined) patch.corujaoIncluirDiretor = dto.incluirDiretor;
    if (dto.autoQtd !== undefined) patch.corujaoAutoQtd = Math.max(0, Math.min(200, Math.floor(dto.autoQtd)));
    if (dto.agendadoPara !== undefined) {
      const d = dto.agendadoPara ? new Date(dto.agendadoPara) : null;
      patch.corujaoAgendadoPara = d && !isNaN(d.getTime()) ? d : null;
    }
    await this.settings.update(patch);
    return this.getConfig();
  }

  async ativarCorretor(userId: string, ativo: boolean) {
    await this.usersRepo.update(userId, { corujao: ativo });
    return { ok: true };
  }

  /** Data de hoje em Brasília (YYYY-MM-DD) — Railway roda em UTC. */
  private hojeBrasilia(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  }

  private horaBrasilia(): string {
    return new Date().toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }

  /** Dispara o repique automático: agendamento único (data+hora) e/ou diário no horário. */
  @Cron(CronExpression.EVERY_MINUTE)
  async cronRepique() {
    const s = await this.settings.get();

    // 1) Agendamento ÚNICO (data+hora marcada). Independe do "ligado" — foi agendado
    // de propósito. Consome o campo ANTES de liberar pra não repetir.
    if (s.corujaoAgendadoPara && new Date(s.corujaoAgendadoPara).getTime() <= Date.now()) {
      await this.settings.update({ corujaoAgendadoPara: null } as any);
      const qtd = (s.corujaoAutoQtd ?? 0) > 0 ? s.corujaoAutoQtd : 200;
      const rel = await this.liberar(qtd);
      const r = await this.puxarEnviar();
      this.logger.log(`Corujão agendado disparou: liberou ${rel.released}, pool ${r.leads}, ${r.notificados} avisado(s).`);
    }

    // 2) Diário no horário (precisa estar ligado).
    if (!s.corujaoEnabled) return;
    const hoje = this.hojeBrasilia();
    if (s.corujaoLastRun === hoje) return; // já rodou hoje
    if (this.horaBrasilia() !== (s.corujaoHora || "14:00")) return;
    await this.settings.update({ corujaoLastRun: hoje } as any);
    // Libera automaticamente a cota do dia (se o Diretor configurou > 0).
    let liberados = 0;
    if ((s.corujaoAutoQtd ?? 0) > 0) {
      liberados = (await this.liberar(s.corujaoAutoQtd)).released;
    }
    const r = await this.puxarEnviar();
    this.logger.log(
      `Corujão automático (${hoje} ${s.corujaoHora}): liberou ${liberados}, pool ${r.leads}, ${r.notificados} avisado(s).`
    );
  }
}
