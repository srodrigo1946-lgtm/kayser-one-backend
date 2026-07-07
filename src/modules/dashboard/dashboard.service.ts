import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, IsNull, LessThan, In } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { Goal } from "../goals/goal.entity";
import { UsersService } from "../users/users.service";
import { subDays, startOfDay, startOfWeek, startOfMonth, endOfMonth } from "date-fns";

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
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

    const qb = this.leadsRepo
      .createQueryBuilder("lead")
      // innerJoin: exclui leads sem responsável ("Sem responsável") do ranking
      .innerJoin("lead.responsavel", "user")
      .select("user.id", "responsavelId")
      .addSelect("user.name", "nome")
      .addSelect("user.role", "role")
      // manda só um booleano (tem foto?) para não trafegar data URIs grandes
      .addSelect("(user.avatar IS NOT NULL)", "hasAvatar")
      // Números do MÊS VIGENTE (barra de progresso respeita o mês)
      .addSelect(
        "COUNT(*) FILTER (WHERE lead.status = :venda AND lead.updatedAt BETWEEN :start AND :end)",
        "vendas"
      )
      .addSelect("COUNT(*) FILTER (WHERE lead.createdAt BETWEEN :start AND :end)", "leads")
      .where("user.role IN (:...roles)", { roles })
      .setParameters({ venda: LeadStatus.VENDA_GANHA, start, end });

    if (scopeIds !== null) {
      qb.andWhere("user.id IN (:...ids)", { ids: scopeIds });
    }

    const rows = await qb
      .groupBy("user.id")
      .orderBy("vendas", "DESC")
      .addOrderBy("leads", "DESC")
      .limit(20)
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

  async getMonthlyData(user: User) {
    const base = await this.scopeWhere(user);
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const start = startOfMonth(date);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);

      const [leads, vendas, visitas] = await Promise.all([
        this.leadsRepo.count({ where: { ...base, createdAt: Between(start, end) } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.VENDA_GANHA, updatedAt: Between(start, end) } }),
        this.leadsRepo.count({ where: { ...base, status: LeadStatus.VISITA_REALIZADA, updatedAt: Between(start, end) } }),
      ]);

      months.push({
        month: date.toLocaleDateString("pt-BR", { month: "short" }),
        leads,
        vendas,
        visitas,
      });
    }
    return months;
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
