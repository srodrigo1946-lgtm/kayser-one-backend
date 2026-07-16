import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, IsNull, LessThan, In } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { Goal } from "../goals/goal.entity";
import { LeadHistory, LeadHistoryType } from "../lead-history/lead-history.entity";
import { UsersService } from "../users/users.service";
import { subDays, startOfDay, startOfWeek, startOfMonth, endOfMonth } from "date-fns";

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly users: UsersService
  ) {}

  /** Fragmento de filtro por escopo: {} para Diretor, responsavelId IN equipe para os demais. */
  private async scopeWhere(user: User): Promise<Record<string, any>> {
    const ids = await this.users.getScopeIds(user);
    return ids === null ? {} : { responsavelId: In(ids) };
  }

  async getMetrics(user: User) {
    const base = await this.scopeWhere(user);
    const now = new Date();

    const [leadsHoje, leadsSemana, leadsMes, visitas, vendas, semAtendimento, semContato] =
      await Promise.all([
        this.leadsRepo.count({ where: { ...base, createdAt: Between(startOfDay(now), now) } }),
        this.leadsRepo.count({ where: { ...base, createdAt: Between(startOfWeek(now), now) } }),
        this.leadsRepo.count({ where: { ...base, createdAt: Between(startOfMonth(now), now) } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.VISITA_REALIZADA } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.VENDA_GANHA } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.NOVO_LEAD, lastContactAt: IsNull() } }),
        this.leadsRepo.count({
          where: { ...base, lastContactAt: LessThan(subDays(now, 3)) },
        }),
      ]);

    const total = leadsMes || 1;
    const conversao = ((vendas / total) * 100);

    return { leadsHoje, leadsSemana, leadsMes, visitas, vendas, conversao, semAtendimento, semContato };
  }

  async getRanking(user: User) {
    const scopeIds = await this.users.getScopeIds(user);
    // Papéis que competem no ranking (Diretor apenas visualiza, não entra)
    const roles = [
      UserRole.SUPERINTENDENTE,
      UserRole.GERENTE_GERAL,
      UserRole.GERENTE,
      UserRole.CORRETOR,
    ];
    const now = new Date();
    const start = startOfMonth(now);
    const end = endOfMonth(now);

    // Parte dos USUÁRIOS desses cargos (todos aparecem, mesmo sem vendas no mês)
    // e conta os leads/vendas do mês por leftJoin.
    const qb = this.userRepo
      .createQueryBuilder("user")
      .leftJoin(Lead, "lead", "lead.responsavelId = user.id")
      .select("user.id", "responsavelId")
      .addSelect("user.name", "nome")
      .addSelect("user.role", "role")
      // manda só um booleano (tem foto?) para não trafegar data URIs grandes
      .addSelect("(user.avatar IS NOT NULL)", "hasAvatar")
      // Números do MÊS VIGENTE (barra de progresso respeita o mês)
      .addSelect(
        "COUNT(lead.id) FILTER (WHERE lead.status = :venda AND lead.updatedAt BETWEEN :start AND :end)",
        "vendas"
      )
      .addSelect("COUNT(lead.id) FILTER (WHERE lead.createdAt BETWEEN :start AND :end)", "leads")
      .where("user.role IN (:...roles)", { roles })
      .andWhere("user.active = true")
      .andWhere("user.approved = true")
      .setParameters({ venda: LeadStatus.VENDA_GANHA, start, end });

    if (scopeIds !== null) {
      qb.andWhere("user.id IN (:...ids)", { ids: scopeIds });
    }

    const rows = await qb
      .groupBy("user.id")
      .orderBy("vendas", "DESC")
      .addOrderBy("leads", "DESC")
      .addOrderBy("user.name", "ASC")
      .limit(50)
      .getRawMany();

    // Meta de vendas do mês vigente por usuário (para a barra de progresso).
    const metas = await this.goalsRepo.find({
      where: { month: now.getMonth() + 1, year: now.getFullYear() },
    });
    const metaByUser = new Map(metas.map((g) => [g.userId, g.targetSales]));

    return rows.map((r) => ({
      ...r,
      vendas: Number(r.vendas) || 0,
      leads: Number(r.leads) || 0,
      meta: metaByUser.get(r.responsavelId) ?? 0,
    }));
  }

  async getMonthlyData(user: User, year?: number) {
    const base = await this.scopeWhere(user);
    const targetYear = year || new Date().getFullYear();
    const months = [];
    // Jan–Dez do ano escolhido (12 meses).
    for (let m = 0; m < 12; m++) {
      const start = new Date(targetYear, m, 1);
      const end = new Date(targetYear, m + 1, 0, 23, 59, 59, 999);

      const [leads, vendas, visitas] = await Promise.all([
        this.leadsRepo.count({ where: { ...base, createdAt: Between(start, end) } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.VENDA_GANHA, updatedAt: Between(start, end) } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.VISITA_REALIZADA, updatedAt: Between(start, end) } }),
      ]);

      months.push({
        month: start.toLocaleDateString("pt-BR", { month: "short" }),
        leads,
        vendas,
        visitas,
      });
    }
    return months;
  }

  /**
   * VGV do período (mês específico ou ano todo): soma de valorVenda das vendas
   * ganhas, e a contagem de vendas. Escopado por equipe.
   */
  async getPeriodVgv(user: User, year: number, month?: number) {
    const scopeIds = await this.users.getScopeIds(user);
    const targetYear = year || new Date().getFullYear();
    const start = month ? new Date(targetYear, month - 1, 1) : new Date(targetYear, 0, 1);
    const end = month
      ? new Date(targetYear, month, 0, 23, 59, 59, 999)
      : new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const qb = this.leadsRepo
      .createQueryBuilder("lead")
      .select("COALESCE(SUM(lead.valorVenda), 0)", "total")
      .addSelect("COUNT(lead.id)", "vendas")
      .where("lead.status = :venda", { venda: LeadStatus.VENDA_GANHA })
      .andWhere("lead.updatedAt BETWEEN :start AND :end", { start, end });

    if (scopeIds !== null) {
      qb.andWhere("lead.responsavelId IN (:...ids)", { ids: scopeIds });
    }

    const row = await qb.getRawOne();
    return { total: Number(row?.total) || 0, vendas: Number(row?.vendas) || 0 };
  }

  /**
   * Campeão do período (mês específico ou o ano todo): corretor com maior VGV
   * (soma de valorVenda das vendas ganhas). Empate desempata por nº de vendas.
   * Escopado por equipe. Retorna null se ninguém tiver venda no período.
   */
  async getChampion(user: User, year: number, month?: number) {
    const scopeIds = await this.users.getScopeIds(user);
    const targetYear = year || new Date().getFullYear();
    const start = month ? new Date(targetYear, month - 1, 1) : new Date(targetYear, 0, 1);
    const end = month
      ? new Date(targetYear, month, 0, 23, 59, 59, 999)
      : new Date(targetYear, 11, 31, 23, 59, 59, 999);

    const qb = this.userRepo
      .createQueryBuilder("user")
      .innerJoin(Lead, "lead", "lead.responsavelId = user.id")
      .select("user.id", "responsavelId")
      .addSelect("user.name", "nome")
      .addSelect("(user.avatar IS NOT NULL)", "hasAvatar")
      .addSelect("COALESCE(SUM(lead.valorVenda), 0)", "vgv")
      .addSelect("COUNT(lead.id)", "vendas")
      .where("lead.status = :venda", { venda: LeadStatus.VENDA_GANHA })
      .andWhere("lead.updatedAt BETWEEN :start AND :end", { start, end })
      .groupBy("user.id")
      .orderBy("vgv", "DESC")
      .addOrderBy("vendas", "DESC")
      .limit(1);

    if (scopeIds !== null) {
      qb.andWhere("user.id IN (:...ids)", { ids: scopeIds });
    }

    const row = await qb.getRawOne();
    if (!row) return null;
    return {
      responsavelId: row.responsavelId,
      nome: row.nome,
      hasAvatar: row.hasAvatar === true || row.hasAvatar === "t" || row.hasAvatar === "true",
      vgv: Number(row.vgv) || 0,
      vendas: Number(row.vendas) || 0,
    };
  }

  /**
   * Follow-ups automáticos que a IA disparou (registrados no histórico do lead).
   * Traz nome + telefone + quando, para o Diretor/gestor ver e clicar direto na
   * conversa. Escopado por equipe. Segue a mesma regra do VGV: mês específico ou,
   * sem mês, o ANO todo consolidado. `total` = quantidade no período (para o card).
   */
  async getFollowups(user: User, year: number, month?: number) {
    const scopeIds = await this.users.getScopeIds(user);
    const targetYear = year || new Date().getFullYear();
    const start = month ? new Date(targetYear, month - 1, 1) : new Date(targetYear, 0, 1);
    const end = month
      ? new Date(targetYear, month, 0, 23, 59, 59, 999)
      : new Date(targetYear, 11, 31, 23, 59, 59, 999);
    const LIKE = "Follow-up automático%";

    const listQb = this.leadsRepo.manager
      .createQueryBuilder(LeadHistory, "h")
      .innerJoin(Lead, "lead", "lead.id = h.leadId")
      .select("h.id", "id")
      .addSelect("h.createdAt", "at")
      .addSelect("h.leadId", "leadId")
      .addSelect("lead.name", "nome")
      .addSelect("lead.phone", "phone")
      .addSelect("lead.whatsapp", "whatsapp")
      .where("h.type = :t", { t: LeadHistoryType.CONTATO })
      .andWhere("h.description LIKE :d", { d: LIKE })
      .andWhere("h.createdAt BETWEEN :start AND :end", { start, end })
      .orderBy("h.createdAt", "DESC")
      .limit(30);

    const countQb = this.leadsRepo.manager
      .createQueryBuilder(LeadHistory, "h")
      .innerJoin(Lead, "lead", "lead.id = h.leadId")
      .where("h.type = :t", { t: LeadHistoryType.CONTATO })
      .andWhere("h.description LIKE :d", { d: LIKE })
      .andWhere("h.createdAt BETWEEN :start AND :end", { start, end });

    if (scopeIds !== null) {
      listQb.andWhere("lead.responsavelId IN (:...ids)", { ids: scopeIds });
      countQb.andWhere("lead.responsavelId IN (:...ids)", { ids: scopeIds });
    }

    const [rows, total] = await Promise.all([listQb.getRawMany(), countQb.getCount()]);
    const items = rows.map((r) => ({
      id: r.id,
      leadId: r.leadId,
      nome: r.nome as string,
      phone: (r.phone || r.whatsapp || "") as string,
      at: r.at as Date,
    }));
    return { items, total };
  }

  async getAlerts(user: User) {
    const base = await this.scopeWhere(user);
    const threeDaysAgo = subDays(new Date(), 3);

    const [semAtendimento, semContato] = await Promise.all([
      this.leadsRepo.find({
        where: { ...base, status: LeadStatus.NOVO_LEAD, lastContactAt: IsNull() },
        relations: ["responsavel"],
        order: { createdAt: "ASC" },
        take: 20,
      }),
      this.leadsRepo.find({
        where: { ...base, lastContactAt: LessThan(threeDaysAgo) },
        relations: ["responsavel"],
        order: { lastContactAt: "ASC" },
        take: 20,
      }),
    ]);

    return { semAtendimento, semContato };
  }
}
