import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, Like, FindOptionsWhere } from "typeorm";
import * as XLSX from "xlsx";
import { Lead, LeadStatus } from "./lead.entity";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { User, UserRole } from "../users/user.entity";

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>
  ) {}

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

    // Hierarchy-based filtering
    if (user.role === UserRole.CORRETOR) {
      where.responsavelId = user.id;
    } else if (user.role === UserRole.GERENTE || user.role === UserRole.GERENTE_GERAL) {
      // Managers see their team's leads — simplified: filter by responsavelId if provided
      if (responsavelId) where.responsavelId = responsavelId;
    }
    // Diretor and Superintendente see all (no filter)

    if (status) where.status = status as LeadStatus;
    if (responsavelId && user.role !== UserRole.CORRETOR) where.responsavelId = responsavelId;

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

  async findOne(id: string) {
    const lead = await this.leadsRepo.findOne({ where: { id }, relations: ["responsavel"] });
    if (!lead) throw new NotFoundException("Lead não encontrado.");
    return lead;
  }

  async create(dto: CreateLeadDto, user: User) {
    const lead = this.leadsRepo.create({
      ...dto,
      responsavelId: dto.responsavelId || (user.role === UserRole.CORRETOR ? user.id : undefined),
    });
    return this.leadsRepo.save(lead);
  }

  async update(id: string, dto: UpdateLeadDto) {
    const lead = await this.findOne(id);
    Object.assign(lead, dto);
    return this.leadsRepo.save(lead);
  }

  async updateStatus(id: string, status: string, order?: number) {
    const lead = await this.findOne(id);
    lead.status = status as LeadStatus;
    if (order !== undefined) lead.kanbanOrder = order;
    // Log history would go here
    return this.leadsRepo.save(lead);
  }

  async remove(id: string) {
    const lead = await this.findOne(id);
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
