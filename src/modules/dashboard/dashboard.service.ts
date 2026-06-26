import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Between, IsNull, Not, LessThan } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { subDays, startOfDay, startOfWeek, startOfMonth } from "date-fns";

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>
  ) {}

  private baseWhere(user: User) {
    if (user.role === UserRole.CORRETOR) return { responsavelId: user.id };
    return {};
  }

  async getMetrics(user: User) {
    const base = this.baseWhere(user);
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
    const result = await this.leadsRepo
      .createQueryBuilder("lead")
      .select("lead.responsavelId", "responsavelId")
      .addSelect("COUNT(*) FILTER (WHERE lead.status = :venda)", "vendas")
      .addSelect("COUNT(*)", "leads")
      .leftJoin("lead.responsavel", "user")
      .addSelect("user.name", "nome")
      .where(user.role === UserRole.CORRETOR ? "lead.responsavelId = :uid" : "1=1", { uid: user.id, venda: LeadStatus.VENDA_GANHA })
      .groupBy("lead.responsavelId")
      .addGroupBy("user.name")
      .orderBy("vendas", "DESC")
      .limit(10)
      .getRawMany();

    return result;
  }

  async getMonthlyData(user: User) {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const start = startOfMonth(date);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      const base = this.baseWhere(user);

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
    const base = this.baseWhere(user);
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
