import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Not, In } from "typeorm";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { LeadsService } from "../leads/leads.service";
import { UsersService } from "../users/users.service";
import { KanbanColumnEntity } from "./kanban-column.entity";

// Colunas padrão — usadas apenas para semear o banco na primeira vez.
export const KANBAN_COLUMNS = [
  { key: "novo_lead", title: "Novo Lead", emoji: "🆕", color: "#6366f1" },
  { key: "primeiro_contato", title: "Primeiro Contato", emoji: "💬", color: "#8b5cf6" },
  { key: "em_atendimento", title: "Em Atendimento", emoji: "📞", color: "#3b82f6" },
  { key: "documentacao", title: "Documentação", emoji: "📄", color: "#06b6d4" },
  { key: "agendamento", title: "Agendamento", emoji: "📅", color: "#10b981" },
  { key: "visita_agendada", title: "Visita Agendada", emoji: "🏢", color: "#f59e0b" },
  { key: "visita_realizada", title: "Visita Realizada", emoji: "✅", color: "#84cc16" },
  { key: "simulacao", title: "Simulação", emoji: "💰", color: "#f97316" },
  { key: "subida_pasta", title: "Subida de Pasta", emoji: "📂", color: "#ec4899" },
  { key: "aprovacao", title: "Aprovação", emoji: "👍", color: "#22c55e" },
  { key: "reprovacao", title: "Reprovação", emoji: "👎", color: "#f97316" },
  { key: "venda_ganha", title: "Venda Ganha", emoji: "🎉", color: "#16a34a" },
  { key: "venda_perdida", title: "Venda Perdida", emoji: "❌", color: "#ef4444" },
];

@Injectable()
export class KanbanService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(KanbanColumnEntity)
    private readonly columnsRepo: Repository<KanbanColumnEntity>,
    private readonly leadsService: LeadsService,
    private readonly users: UsersService
  ) {}

  /** Semeia as colunas padrão na primeira vez que o board é acessado. */
  private async ensureSeeded() {
    const count = await this.columnsRepo.count();
    if (count === 0) {
      const cols = KANBAN_COLUMNS.map((c, i) =>
        this.columnsRepo.create({ ...c, position: i })
      );
      await this.columnsRepo.save(cols);
    }
  }

  async listColumns() {
    await this.ensureSeeded();
    return this.columnsRepo.find({ order: { position: "ASC" } });
  }

  async getBoard(user: User) {
    const columns = await this.listColumns();
    // Escopo por equipe: Diretor (null) vê todos; demais veem só a sua equipe.
    const scopeIds = await this.users.getScopeIds(user);
    const where = scopeIds === null ? {} : { responsavelId: In(scopeIds) };
    const leads = await this.leadsRepo.find({
      where,
      relations: ["responsavel"],
      order: { kanbanOrder: "ASC", updatedAt: "DESC" },
    });

    return columns.map((col) => ({
      id: col.key, // o front usa como status (drag & drop)
      columnId: col.id, // id no banco (para editar/remover)
      title: col.title,
      emoji: col.emoji,
      color: col.color,
      leads: leads.filter((l) => l.status === col.key),
    }));
  }

  async moveCard(leadId: string, toStatus: string, toOrder: number, user?: User) {
    // Delega ao LeadsService para registrar o histórico da movimentação.
    return this.leadsService.updateStatus(leadId, toStatus, toOrder, user);
  }

  /* ---------------- Edição de colunas (somente Diretor) ---------------- */

  private slug(text: string): string {
    return (
      text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "") // remove acentos
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "coluna"
    );
  }

  async createColumn(dto: { title: string; emoji?: string; color?: string }) {
    await this.ensureSeeded();
    const base = this.slug(dto.title);
    let key = base;
    let i = 1;
    while (await this.columnsRepo.findOne({ where: { key } })) {
      key = `${base}_${i++}`;
    }
    const max = await this.columnsRepo
      .createQueryBuilder("c")
      .select("MAX(c.position)", "max")
      .getRawOne<{ max: number | string | null }>();
    const col = this.columnsRepo.create({
      key,
      title: dto.title,
      emoji: dto.emoji || "📋",
      color: dto.color || "#6366f1",
      position: Number(max?.max ?? -1) + 1,
    });
    return this.columnsRepo.save(col);
  }

  async updateColumn(id: string, dto: { title?: string; emoji?: string; color?: string }) {
    const col = await this.columnsRepo.findOne({ where: { id } });
    if (!col) throw new NotFoundException("Coluna não encontrada.");
    if (dto.title !== undefined) col.title = dto.title;
    if (dto.emoji !== undefined) col.emoji = dto.emoji;
    if (dto.color !== undefined) col.color = dto.color;
    return this.columnsRepo.save(col);
  }

  async reorder(ids: string[]) {
    for (let i = 0; i < ids.length; i++) {
      await this.columnsRepo.update({ id: ids[i] }, { position: i });
    }
    return this.listColumns();
  }

  async deleteColumn(id: string) {
    const col = await this.columnsRepo.findOne({ where: { id } });
    if (!col) throw new NotFoundException("Coluna não encontrada.");
    // Move os leads dessa coluna para a primeira coluna restante (evita órfãos).
    const destino = await this.columnsRepo.findOne({
      where: { id: Not(id) },
      order: { position: "ASC" },
    });
    if (destino) {
      await this.leadsRepo.update({ status: col.key }, { status: destino.key });
    }
    await this.columnsRepo.remove(col);
    return { message: "Coluna removida." };
  }
}
