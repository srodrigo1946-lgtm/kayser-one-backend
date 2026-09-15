import { Injectable, Logger, NotFoundException, ForbiddenException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository, Like, In, FindOptionsWhere } from "typeorm";
import * as XLSX from "xlsx";
import { Lead, LeadStatus, LeadSource } from "./lead.entity";
import { Conversation } from "../conversations/conversation.entity";
import { LeadQueueAssignment } from "../lead-queue/lead-queue-assignment.entity";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { LeadHistoryService } from "../lead-history/lead-history.service";
import { LeadHistoryType } from "../lead-history/lead-history.entity";

@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(LeadQueueAssignment)
    private readonly assignRepo: Repository<LeadQueueAssignment>,
    private readonly history: LeadHistoryService,
    private readonly users: UsersService,
    private readonly config: ConfigService
  ) {}

  async findHistory(leadId: string, user?: User) {
    // Valida o escopo do lead antes de devolver a timeline (evita IDOR por id).
    await this.findOne(leadId, user);
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
      // `responsavel.manager` = gestor do responsável (para mostrar a equipe ao lado).
      relations: ["responsavel", "responsavel.manager"],
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    // Nunca vazar o hash de senha do responsável nem do gestor.
    for (const l of leads) {
      if (l.responsavel) {
        delete (l.responsavel as any).passwordHash;
        if ((l.responsavel as any).manager) delete (l.responsavel as any).manager.passwordHash;
      }
    }

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

  /** Só dígitos, pra comparar telefone independente de formatação/máscara. */
  private soDigitos(v?: string | null): string {
    return (v || "").replace(/\D/g, "");
  }

  /**
   * Barra cadastro de lead DUPLICADO (mesmo telefone). Se já existe, avisa quem
   * tentou (mensagem), registra no histórico do lead existente e avisa o corretor
   * responsável + o gerente dele por e-mail (best-effort). Só vale no cadastro
   * MANUAL — os fluxos automáticos (anúncio/WhatsApp) passam source próprio.
   */
  private async assertNaoDuplicado(dto: CreateLeadDto) {
    const digits = this.soDigitos(dto.phone) || this.soDigitos(dto.whatsapp);
    if (!digits) return;
    // Casa pelos últimos 8 dígitos (portável Postgres/sqlite) e confirma no JS.
    const tail = digits.slice(-8);
    const candidatos = await this.leadsRepo.find({
      where: [{ phone: Like(`%${tail}`) }, { whatsapp: Like(`%${tail}`) }],
      relations: ["responsavel", "responsavel.manager"],
    });
    const dup = candidatos.find(
      (c) => this.soDigitos(c.phone) === digits || this.soDigitos(c.whatsapp) === digits
    );
    if (!dup) return;

    const dono = dup.responsavel?.name || "sem responsável";
    await this.avisarDuplicidade(dup).catch(() => {});
    throw new ConflictException(
      `Já existe um lead com esse telefone: "${dup.name}" — responsável: ${dono}. Não foi cadastrado de novo.`
    );
  }

  /** Registra no histórico do lead existente e avisa corretor + gerente por e-mail. */
  private async avisarDuplicidade(dup: Lead) {
    await this.history
      .log({
        leadId: dup.id,
        type: LeadHistoryType.SISTEMA,
        description: "Tentativa de cadastrar este cliente de novo (telefone já existe). Cadastro bloqueado.",
      })
      .catch(() => {});

    const destinos = [dup.responsavel?.email, dup.responsavel?.manager?.email].filter(
      (e): e is string => !!e
    );
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    if (!apiKey || destinos.length === 0) return;
    const from = this.config.get<string>("SUPPORT_FROM", "Kayser One <onboarding@resend.dev>");
    const html = `
      <div style="font-family:Arial,sans-serif">
        <h2>⚠️ Cliente já cadastrado</h2>
        <p>Alguém tentou cadastrar de novo um cliente que já está no Kayser One:</p>
        <p><b>${dup.name}</b>${dup.phone ? ` — ${dup.phone}` : ""}</p>
        <p>Responsável atual: <b>${dup.responsavel?.name || "—"}</b>. O cadastro duplicado foi bloqueado.</p>
        <p><a href="https://www.kayserone.com.br/leads">Abrir no Kayser One</a></p>
      </div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: destinos,
        subject: "⚠️ Cliente já cadastrado — Kayser One",
        html,
      }),
    }).then((r) => {
      if (!r.ok) this.logger.warn(`Resend (duplicidade) falhou (${r.status})`);
    });
  }

  async create(dto: CreateLeadDto, user: User, source: LeadSource = LeadSource.MANUAL) {
    // Só o cadastro manual barra duplicado — anúncio/WhatsApp entram por source próprio.
    if (source === LeadSource.MANUAL) await this.assertNaoDuplicado(dto);
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
    // Origem PAGA (anúncio/formulário Meta) mexe no Custo por Lead — só o Diretor
    // marca. Corretor/gerente pode marcar origem NÃO-paga (ex.: "Time X" = manual)
    // pra identificar o time, MAS não pode criar nem TIRAR uma origem paga (não
    // rebaixa um lead de anúncio pra manual e some do custo).
    const SOURCE_PAGO = ["anuncio", "formulario_meta"];
    if (dto.source !== undefined && user && user.role !== UserRole.DIRETOR) {
      if (SOURCE_PAGO.includes(dto.source) || SOURCE_PAGO.includes(lead.source)) {
        delete (dto as any).source;
      }
    }
    // Reatribuição só dentro da equipe do usuário.
    if (dto.responsavelId && user) {
      const scopeIds = await this.users.getScopeIds(user);
      if (scopeIds !== null && !scopeIds.includes(dto.responsavelId)) {
        throw new ForbiddenException("Você só pode atribuir o lead a alguém da sua equipe.");
      }
    }
    const prevResponsavelId = lead.responsavelId ?? null;
    Object.assign(lead, dto);
    // GOTCHA TypeORM: o lead vem de findOne com a relação `responsavel` carregada
    // (o usuário ANTIGO). No save(), a relação vence o FK e regravaria o antigo —
    // a transferência "funcionava" na resposta mas não persistia. Soltar a relação
    // faz valer o responsavelId novo.
    if (dto.responsavelId !== undefined) {
      (lead as any).responsavel = undefined;
    }
    const saved = await this.leadsRepo.save(lead);

    // Sincroniza o atendente da conversa vinculada quando o responsável do lead
    // muda (transferir o lead move a conversa junto). Escreve direto no repo da
    // conversa — não chama ConversationsService, então não há loop.
    if (dto.responsavelId !== undefined) {
      const newResponsavelId = saved.responsavelId ?? null;
      if (newResponsavelId !== prevResponsavelId) {
        await this.convRepo.update({ leadId: saved.id }, { assignedToId: newResponsavelId });
      }
    }
    return saved;
  }

  async updateStatus(id: string, status: string, order?: number, user?: User) {
    const lead = await this.findOne(id, user);
    const fromStatus = lead.status;
    lead.status = status as LeadStatus;
    if (order !== undefined) lead.kanbanOrder = order;
    // Ao fechar a venda, grava a DATA (só se ainda não tiver — não sobrescreve edição).
    if (lead.status === LeadStatus.VENDA_GANHA && !lead.dataVenda) {
      lead.dataVenda = new Date().toISOString().slice(0, 10);
    }
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
      // Saiu de "Novo Lead" (ex.: foi pra Primeiro Contato) = corretor atendeu:
      // encerra a atribuição pendente NA HORA (para o relógio do card e não repassa).
      if (saved.status !== LeadStatus.NOVO_LEAD) {
        await this.assignRepo
          .update({ leadId: saved.id, status: "pendente" }, { status: "atendido" })
          .catch(() => {});
      }
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
