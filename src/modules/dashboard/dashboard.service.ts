import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, IsNull, LessThan, In } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { subDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
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
    const qb = this.leadsRepo
      .createQueryBuilder("lead")
      // innerJoin: exclui leads sem responsável ("Sem responsável") do ranking
      .innerJoin("lead.responsavel", "user")
      .select("lead.responsavelId", "responsavelId")
      .addSelect("COUNT(*) FILTER (WHERE lead.status = :venda)", "vendas")
      .addSelect("COUNT(*)", "leads")
      .addSelect("user.name", "nome")
      // Diretor não compete no ranking (apenas o visualiza)
      .where("user.role != :diretor", { diretor: UserRole.DIRETOR })
      .setParameter("venda", LeadStatus.VENDA_GANHA);

    if (scopeIds !== null) {
      qb.andWhere("lead.responsavelId IN (:...ids)", { ids: scopeIds });
    }

    return qb
      .groupBy("lead.responsavelId")
      .addGroupBy("user.name")
      .orderBy("vendas", "DESC")
      .limit(10)
      .getRawMany();
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
