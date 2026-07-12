import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Like, In, FindOptionsWhere } from "typeorm";
import * as XLSX from "xlsx";
import { Lead, LeadStatus, LeadSource } from "./lead.entity";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly history: LeadHistoryService,
    private readonly users: UsersService
  ) {}

  findHistory(leadId: string) {
    return this.history.findByLead(leadId);
  }

  async findAll(params: {
    status?: string;
    responsavelId?: string;
    search?: string;
    page?: number;
    limit?: number;
    user: User;
  }) {
    const { status, responsavelId, search, page = 1, limit = 50, user } = params;

    const where: FindOptionsWhere<Lead> = {};

    // Escopo por hierarquia: cada gestor vê apenas a sua equipe (descendentes);
    // Diretor (scope null) vê tudo; Corretor vê apenas os próprios leads.
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) {
      // Se um responsável específico foi pedido e está dentro do escopo, filtra por ele;
      // senão, restringe a toda a equipe do usuário.
      if (responsavelId && scopeIds.includes(responsavelId)) {
        where.responsavelId = responsavelId;
      } else {
        where.responsavelId = In(scopeIds);
      }
    } else if (responsavelId) {
      where.responsavelId = responsavelId;
    }

    if (status) where.status = status as LeadStatus;

    const [leads, total] = await this.leadsRepo.findAndCount({
      where: search
        ? [
            { ...where, name: Like(`%${search}%`) },
            { ...where, phone: Like(`%${search}%`) },
            { ...where, email: Like(`%${search}%`) },
          ]
        : where,
      relations: ["responsavel"],
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: leads,
      total,
      page,
      pages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string, user?: User) {
    const lead = await this.leadsRepo.findOne({ where: { id }, relations: ["responsavel"] });
    if (!lead) throw new NotFoundException("Lead não encontrado.");
    await this.assertScope(lead, user);
    return lead;
  }

  /** Garante que o usuário só acessa leads da sua equipe (Diretor acessa tudo). */
  private async assertScope(lead: Lead, user?: User) {
    if (!user) return; // chamada interna sem contexto de usuário
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds === null) return; // Diretor vê tudo
    if (!lead.responsavelId || !scopeIds.includes(lead.responsavelId)) {
      throw new ForbiddenException("Você não tem acesso a este lead.");
    }
  }

  async create(dto: CreateLeadDto, user: User, source: LeadSource = LeadSource.MANUAL) {
    const lead = this.leadsRepo.create({
      ...dto,
      source,
      responsavelId: dto.responsavelId || (user.role === UserRole.CORRETOR ? user.id : undefined),
    });
    const saved = await this.leadsRepo.save(lead);
    await this.history.log({
      leadId: saved.id,
      type: LeadHistoryType.CRIACAO,
      description: `Lead criado por ${user.name}.`,
      userId: user.id,
    });
    return saved;
  }

  async update(id: string, dto: UpdateLeadDto, user?: User) {
    const lead = await this.findOne(id, user);
    // Reatribuição só dentro da equipe do usuário.
    if (dto.responsavelId && user) {
      const scopeIds = await this.users.getScopeIds(user);
      if (scopeIds !== null && !scopeIds.includes(dto.responsavelId)) {
        throw new ForbiddenException("Você só pode atribuir o lead a alguém da sua equipe.");
      }
    }
    Object.assign(lead, dto);
    return this.leadsRepo.save(lead);
  }

  async updateStatus(id: string, status: string, order?: number, user?: User) {
    const lead = await this.findOne(id, user);
    const fromStatus = lead.status;
    lead.status = status as LeadStatus;
    if (order !== undefined) lead.kanbanOrder = order;
    const saved = await this.leadsRepo.save(lead);
    if (fromStatus !== saved.status) {
      await this.history.log({
        leadId: saved.id,
        type: LeadHistoryType.MUDANCA_STATUS,
        description: `Status alterado de "${fromStatus}" para "${saved.status}".`,
        fromStatus,
        toStatus: saved.status,
        userId: user?.id,
      });
    }
    return saved;
  }

  async remove(id: string, user?: User) {
    const lead = await this.findOne(id, user);
    await this.leadsRepo.remove(lead);
    return { message: "Lead removido." };
  }

  async importFromExcel(file: Express.Multer.File, user: User) {
    const wb = XLSX.read(file.buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: "" });

    const columnMap: Record<string, keyof CreateLeadDto> = {
      "nome": "name",
      "telefone": "phone",
      "whatsapp": "whatsapp",
      "email": "email",
      "empreendimento": "empreendimento",
      "origem": "origem",
      "campanha": "campanha",
      "cidade": "cidade",
      "renda": "renda",
      "fgts": "fgts",
      "entrada": "entrada",
      "observacoes": "observacoes",
    };

    const leads: Lead[] = [];
    let duplicates = 0;

    for (const row of rows) {
      const dto: Partial<CreateLeadDto> = {};
      for (const [col, field] of Object.entries(columnMap)) {
        const val = row[col] ?? row[col.toUpperCase()] ?? row[col.charAt(0).toUpperCase() + col.slice(1)];
        if (val !== undefined && val !== "") (dto as any)[field] = val;
      }
      if (!dto.name || !dto.phone) continue;

      // Check duplicate
      const exists = await this.leadsRepo.findOne({ where: { phone: dto.phone } });
      if (exists) { duplicates++; continue; }

      const entity = this.leadsRepo.create({
        ...dto,
        responsavelId: user.role === UserRole.CORRETOR ? user.id : undefined,
      } as Partial<Lead>);
      leads.push(entity);
    }

    if (leads.length) await this.leadsRepo.save(leads);

    return {
      imported: leads.length,
      duplicates,
      total: rows.length,
    };
  }

  async exportToExcel(user: User) {
    const { data } = await this.findAll({ user, limit: 10000 });
    const rows = data.map((l) => ({
      Nome: l.name,
      Telefone: l.phone,
      WhatsApp: l.whatsapp || "",
      Email: l.email || "",
      Empreendimento: l.empreendimento || "",
      Origem: l.origem || "",
      Cidade: l.cidade || "",
      Renda: l.renda || "",
      FGTS: l.fgts || "",
      Status: l.status,
      Responsavel: l.responsavel?.name || "",
      Cadastro: l.createdAt,
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Leads");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  }
}
