import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Lead, LeadStatus } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { LeadsService } from "../leads/leads.service";

export const KANBAN_COLUMNS = [
  { id: "novo_lead", title: "Novo Lead", emoji: "🆕", color: "#6366f1" },
  { id: "primeiro_contato", title: "Primeiro Contato", emoji: "💬", color: "#8b5cf6" },
  { id: "em_atendimento", title: "Em Atendimento", emoji: "📞", color: "#3b82f6" },
  { id: "documentacao", title: "Documentação", emoji: "📄", color: "#06b6d4" },
  { id: "agendamento", title: "Agendamento", emoji: "📅", color: "#10b981" },
  { id: "visita_agendada", title: "Visita Agendada", emoji: "🏢", color: "#f59e0b" },
  { id: "visita_realizada", title: "Visita Realizada", emoji: "✅", color: "#84cc16" },
  { id: "simulacao", title: "Simulação", emoji: "💰", color: "#f97316" },
  { id: "subida_pasta", title: "Subida de Pasta", emoji: "📂", color: "#ec4899" },
  { id: "assinatura", title: "Assinatura", emoji: "✍️", color: "#14b8a6" },
  { id: "venda_ganha", title: "Venda Ganha", emoji: "🎉", color: "#22c55e" },
  { id: "venda_perdida", title: "Venda Perdida", emoji: "❌", color: "#ef4444" },
];

@Injectable()
export class KanbanService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly leadsService: LeadsService
  ) {}

  async getBoard(user: User) {
    const where = user.role === UserRole.CORRETOR ? { responsavelId: user.id } : {};

    const leads = await this.leadsRepo.find({
      where,
      relations: ["responsavel"],
      order: { kanbanOrder: "ASC", updatedAt: "DESC" },
    });

    return KANBAN_COLUMNS.map((col) => ({
      ...col,
      leads: leads.filter((l) => l.status === col.id),
    }));
  }

  async moveCard(leadId: string, toStatus: LeadStatus, toOrder: number, user?: User) {
    // Delega ao LeadsService para registrar o histórico da movimentação.
    return this.leadsService.updateStatus(leadId, toStatus, toOrder, user);
  }
}
