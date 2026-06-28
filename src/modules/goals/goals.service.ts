import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { Goal } from "./goal.entity";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";

export interface GoalProgress {
  goal: Goal;
  achievedSales: number;
  achievedVisits: number;
  salesPct: number;
  visitsPct: number;
}

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>
  ) {}

  private now() {
    const d = new Date();
    return { month: d.getMonth() + 1, year: d.getFullYear() };
  }

  async findAll(user: User, month?: number, year?: number) {
    const m = month || this.now().month;
    const y = year || this.now().year;
    const where: any = { month: m, year: y };
    if (user.role === UserRole.CORRETOR) where.userId = user.id;
    return this.goalsRepo.find({ where, relations: ["user"], order: { targetSales: "DESC" } });
  }

  /** Cria ou atualiza a meta do usuário/mês/ano. */
  async upsert(dto: { userId: string; month: number; year: number; targetSales?: number; targetVisits?: number }) {
    let goal = await this.goalsRepo.findOne({
      where: { userId: dto.userId, month: dto.month, year: dto.year },
    });
    if (!goal) {
      goal = this.goalsRepo.create(dto);
    } else {
      if (dto.targetSales !== undefined) goal.targetSales = dto.targetSales;
      if (dto.targetVisits !== undefined) goal.targetVisits = dto.targetVisits;
    }
    return this.goalsRepo.save(goal);
  }

  async remove(id: string) {
    const goal = await this.goalsRepo.findOne({ where: { id } });
    if (!goal) throw new NotFoundException("Meta não encontrada.");
    await this.goalsRepo.remove(goal);
    return { message: "Meta removida." };
  }

  /** Calcula o progresso (vendas/visitas realizadas no mês) para cada meta no escopo. */
  async getProgress(user: User, month?: number, year?: number): Promise<GoalProgress[]> {
    const m = month || this.now().month;
    const y = year || this.now().year;
    const goals = await this.findAll(user, m, y);

    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59);

    const progress: GoalProgress[] = [];
    for (const goal of goals) {
      const [achievedSales, achievedVisits] = await Promise.all([
        this.leadsRepo.count({
          where: { responsavelId: goal.userId, status: LeadStatus.VENDA_GANHA, updatedAt: Between(start, end) },
        }),
        this.leadsRepo.count({
          where: { responsavelId: goal.userId, status: LeadStatus.VISITA_REALIZADA, updatedAt: Between(start, end) },
        }),
      ]);
      progress.push({
        goal,
        achievedSales,
        achievedVisits,
        salesPct: goal.targetSales > 0 ? Math.min((achievedSales / goal.targetSales) * 100, 100) : 0,
        visitsPct: goal.targetVisits > 0 ? Math.min((achievedVisits / goal.targetVisits) * 100, 100) : 0,
      });
    }
    return progress;
  }
}
