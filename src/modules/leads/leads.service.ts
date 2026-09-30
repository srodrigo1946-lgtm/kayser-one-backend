import { Injectable, Logger, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { detectarEmpreendimento } from "../knowledge/knowledge.service";
import { bloquearTelefones } from "./bloqueio";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository, Like, In, FindOptionsWhere, MoreThan, IsNull } from "typeorm";
import { Appointment, AppointmentStatus } from "../appointments/appointment.entity";
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

/** Cabeçalho normalizado: minúsculo, sem acento, só letras/números ("Nome Completo" → "nomecompleto"). */
function normCab(h: any): string {
  return String(h ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

/** Qual campo do lead cada cabeçalho representa (aceita os nomes mais comuns de planilha). */
export function campoDoCabecalho(h: any): keyof CreateLeadDto | null {
  const c = normCab(h);
  if (!c) return null;
  if (/^(whatsapp|whats|zap|wpp)/.test(c)) return "whatsapp";
  if (/(telefone|celular|fone|^tel|phone|contato|numero|^cel)/.test(c)) return "phone";
  if (/(email|mail)/.test(c)) return "email";
  if (/^(nome|cliente|name|fullname|lead|nomedo|nomecliente)/.test(c)) return "name";
  if (/(empreendimento|imovel|produto)/.test(c)) return "empreendimento";
  if (/^origem/.test(c)) return "origem";
  if (/^campanha/.test(c)) return "campanha";
  if (/^cidade/.test(c)) return "cidade";
  if (/^renda/.test(c)) return "renda";
  if (/^fgts/.test(c)) return "fgts";
  if (/^entrada/.test(c)) return "entrada";
  if (/^(obs|observa)/.test(c)) return "observacoes";
  return null;
}

/** "isaac" / "time isaac" / "TIME  Isaac" → "Time Isaac". Vazio → "". */
export function nomeDoTime(t?: string | null): string {
  const limpo = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!limpo) return "";
  const semPrefixo = limpo.replace(/^time(\s+|$)/i, "").trim();
  if (!semPrefixo) return "";
  // Origem que não é time: Corujão (repique) fica com o nome próprio.
  if (/^coruj[aã]o$/i.test(semPrefixo)) return "Corujão";
  const cap = semPrefixo.replace(/(^|\s)(\p{L})/gu, (_m, esp: string, l: string) => esp + l.toUpperCase());
  return `Time ${cap}`;
}

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

  /** Apaga item do histórico (ou tudo, sem historyId). Só Diretor — guard no controller. */
  async removeHistory(leadId: string, user: User, historyId?: string) {
    await this.findOne(leadId, user);
    const r = await this.history.remove(leadId, historyId);
    if (historyId && r.removidos === 0) throw new NotFoundException("Item do histórico não encontrado.");
    return r;
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
    // Cargo abaixo do Diretor cadastra COM o time de origem (ex.: "Time Isaac"):
    // não mistura com lead de anúncio nem com os do Diretor, e não conta no painel.
    if (source === LeadSource.MANUAL && user.role !== UserRole.DIRETOR) {
      const time = nomeDoTime(dto.origem);
      if (!time) throw new BadRequestException("Informe o time de origem do lead (ex.: Time Isaac).");
      dto = { ...dto, origem: time };
      source = LeadSource.TIME;
    }
    // Responsável escolhido tem que ser da equipe de quem cadastra (Diretor = qualquer um).
    if (dto.responsavelId) {
      const scopeIds = await this.users.getScopeIds(user);
      if (scopeIds !== null && !scopeIds.includes(dto.responsavelId)) {
        throw new ForbiddenException("Você só pode atribuir o lead a alguém da sua equipe.");
      }
    }
    const lead = this.leadsRepo.create({
      ...dto,
      source,
      // Cargo que cadastra fica responsável (antes só o Corretor: lead de gerente
      // ficava sem dono e sumia da tela dele). Diretor deixa livre pra distribuir.
      responsavelId: dto.responsavelId || (user.role === UserRole.DIRETOR ? undefined : user.id),
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
    const prevStatus = lead.status;
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
    if (saved.status === LeadStatus.VENDA_PERDIDA && prevStatus !== LeadStatus.VENDA_PERDIDA) {
      await this.arquivarSemInteresse(saved);
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
      if (saved.status === LeadStatus.VENDA_PERDIDA) await this.arquivarSemInteresse(saved);
    }
    return saved;
  }

  /**
   * "Cliente sem interesse" (venda_perdida): o lead volta pro Diretor como
   * responsável (sai da carteira do corretor) e o histórico é apagado.
   */
  async arquivarSemInteresse(lead: Lead) {
    try {
      const diretor = await this.leadsRepo.manager.getRepository(User).findOne({
        where: { role: UserRole.DIRETOR, empresaId: IsNull() },
        order: { createdAt: "ASC" },
      });
      if (diretor) {
        await this.leadsRepo.update(lead.id, { responsavelId: diretor.id });
        await this.convRepo.update({ leadId: lead.id }, { assignedToId: diretor.id }).catch(() => {});
        lead.responsavelId = diretor.id;
        (lead as any).responsavel = undefined;
      }
      await this.assignRepo
        .update({ leadId: lead.id, status: In(["pendente", "aguardando"]) }, { status: "atendido" })
        .catch(() => {});
      await this.history.remove(lead.id);
    } catch (err) {
      this.logger.warn(`Falha ao arquivar lead sem interesse ${lead.id}: ${(err as Error).message}`);
    }
  }

  async remove(id: string, user?: User) {
    const lead = await this.findOne(id, user);
    // Visitas FUTURAS desse lead não fazem mais sentido: cancela (some da Agenda e dos
    // avisos do Kanban/sino). As passadas ficam como histórico.
    await this.leadsRepo.manager
      .getRepository(Appointment)
      .update(
        { leadId: lead.id, status: AppointmentStatus.AGENDADO, scheduledAt: MoreThan(new Date()) },
        { status: AppointmentStatus.CANCELADO }
      )
      .catch((err) => this.logger.warn(`Falha ao cancelar visitas do lead excluído: ${(err as Error).message}`));
    // Excluído = não volta (o formulário do Meta e o WhatsApp não recriam esse telefone).
    await bloquearTelefones(this.leadsRepo.manager, lead.phone, lead.whatsapp).catch((err) =>
      this.logger.warn(`Falha ao bloquear telefone do lead excluído: ${(err as Error).message}`)
    );
    await this.leadsRepo.remove(lead);
    return { message: "Lead removido." };
  }

  /** Coluna do Kanban válida pra quem importa (+ dono forçado: "sem interesse" = Diretor). */
  private async resolverColuna(status: string | undefined, user: User): Promise<{ key?: string; dono?: string }> {
    if (!status || !status.trim()) return {};
    const col: any[] = await this.leadsRepo.manager
      .query(`SELECT key, "somenteGestores" FROM kanban_columns WHERE key = $1`, [status.trim()])
      .catch(() => []);
    if (!col.length) throw new BadRequestException("Coluna do Kanban não encontrada.");
    if (col[0].somenteGestores && user.role === UserRole.CORRETOR) {
      throw new BadRequestException("Essa coluna é só para gerentes.");
    }
    if (col[0].key === LeadStatus.VENDA_PERDIDA) {
      const d: any[] = await this.leadsRepo.manager
        .query(`SELECT id FROM users WHERE role = 'diretor' AND "empresaId" IS NULL ORDER BY "createdAt" ASC LIMIT 1`)
        .catch(() => []);
      return { key: col[0].key, dono: d[0]?.id };
    }
    return { key: col[0].key };
  }

  async importFromExcel(file: Express.Multer.File, user: User, time?: string, status?: string, lotesJson?: string) {
    if (!file?.buffer) throw new BadRequestException("Envie a planilha.");
    // Coluna do Kanban onde os leads entram (vazio = Novo Lead).
    const padrao = await this.resolverColuna(status, user);
    const colunaStatus = padrao.key;
    const donoColuna = padrao.dono;

    // LOTES: a mesma planilha repartida — ex.: 10 pro Isaac, 50 pra coluna X, o resto padrão.
    // Na ordem da planilha; só conta lead que ENTROU (duplicado não gasta a cota).
    type Lote = { quantidade: number; responsavelId?: string; status?: string; dono?: string; origem?: string };
    const lotes: Lote[] = [];
    if (lotesJson && lotesJson.trim()) {
      let brutos: any[] = [];
      try {
        brutos = JSON.parse(lotesJson);
      } catch {
        throw new BadRequestException("Lotes inválidos.");
      }
      const scopeIds = await this.users.getScopeIds(user);
      for (const b of Array.isArray(brutos) ? brutos : []) {
        const quantidade = Math.floor(Number(b?.quantidade));
        if (!quantidade || quantidade < 1) continue;
        const responsavelId = b?.responsavelId ? String(b.responsavelId) : undefined;
        if (responsavelId && scopeIds !== null && !scopeIds.includes(responsavelId)) {
          throw new BadRequestException("Você só pode mandar lote pra alguém da sua equipe.");
        }
        const c = await this.resolverColuna(b?.status, user);
        const origem = b?.origem ? nomeDoTime(String(b.origem)) || undefined : undefined;
        lotes.push({ quantidade, responsavelId, status: c.key, dono: c.dono, origem });
      }
    }
    // Cargos abaixo do Diretor: a planilha tem que dizer de qual TIME é
    // (ex.: "Time Isaac"), pra não misturar com os leads que já existem.
    const nomeTime = nomeDoTime(time);
    if (user.role !== UserRole.DIRETOR && !nomeTime) {
      throw new BadRequestException("Informe o nome do time da planilha (ex.: Time Isaac).");
    }
    const wb = XLSX.read(file.buffer, { type: "buffer" });
    // Acha a aba e a LINHA de cabeçalho (pode não ser a 1ª) que tenha telefone/celular.
    let linhas: any[][] = [];
    let cab = -1;
    let mapa: (keyof CreateLeadDto | null)[] = [];
    const cabecalhosVistos: string[] = [];
    for (const nome of wb.SheetNames) {
      const arr: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[nome], { header: 1, defval: "" });
      for (let i = 0; i < Math.min(arr.length, 15); i++) {
        const m = (arr[i] || []).map(campoDoCabecalho);
        if (i === 0) cabecalhosVistos.push(...(arr[i] || []).map(String).filter(Boolean));
        if (m.includes("phone") || m.includes("whatsapp")) {
          linhas = arr; cab = i; mapa = m;
          break;
        }
      }
      if (cab >= 0) break;
    }
    if (cab < 0) {
      throw new BadRequestException(
        `Não achei a coluna de TELEFONE na planilha. Use um cabeçalho como "Nome" e "Telefone" (ou Celular/WhatsApp).` +
          (cabecalhosVistos.length ? ` Colunas encontradas: ${cabecalhosVistos.slice(0, 12).join(", ")}.` : "")
      );
    }
    const rows = linhas.slice(cab + 1).filter((r) => (r || []).some((v) => String(v ?? "").trim() !== ""));

    // Empreendimento só entra se bater com um imóvel cadastrado (texto solto tipo
    // "Força de vendas"/"Automação" é ignorado).
    let imoveis: { id: string; name: string }[] = [];
    try {
      imoveis = await this.leadsRepo.manager.query(`SELECT id, name FROM properties WHERE active = true`);
    } catch {
      imoveis = [];
    }
    const importId = randomUUID();

    const leads: Lead[] = [];
    let duplicates = 0;
    let semTelefone = 0;
    const vistos = new Set<string>();

    for (const row of rows) {
      const dto: Partial<CreateLeadDto> = {};
      mapa.forEach((field, i) => {
        if (!field) return;
        const val = row[i];
        if (val === undefined || String(val).trim() === "") return;
        if ((dto as any)[field] === undefined) (dto as any)[field] = String(val).trim();
      });
      // Telefone: só dígitos (Excel às vezes guarda como número). Sem telefone, usa o WhatsApp.
      const tel = String(dto.phone || dto.whatsapp || "").replace(/\D/g, "");
      if (tel.length < 8) { semTelefone++; continue; }
      dto.phone = tel;
      if (dto.whatsapp) dto.whatsapp = String(dto.whatsapp).replace(/\D/g, "") || undefined;
      if (!dto.name) dto.name = "Contato da planilha";
      if (dto.empreendimento) {
        const imovel = detectarEmpreendimento(String(dto.empreendimento), imoveis);
        if (imovel) {
          dto.empreendimento = imovel.name;
          (dto as any).propertyId = imovel.id;
        } else {
          delete dto.empreendimento;
        }
      }

      // Duplicado: com/sem 55, no cadastro ou repetido dentro da própria planilha.
      const sem55 = tel.startsWith("55") && tel.length >= 12 ? tel.slice(2) : tel;
      const tels = [sem55, `55${sem55}`];
      if (tels.some((t) => vistos.has(t))) { duplicates++; continue; }
      tels.forEach((t) => vistos.add(t));
      const exists = await this.leadsRepo.findOne({ where: [{ phone: In(tels) }, { whatsapp: In(tels) }] });
      if (exists) { duplicates++; continue; }

      // Qual lote esta linha pega (pela quantidade já importada).
      let acum = 0;
      const lote = lotes.find((l) => {
        acum += l.quantidade;
        return leads.length < acum;
      });
      if (nomeTime) dto.campanha = dto.campanha ? `${nomeTime} — ${dto.campanha}` : nomeTime;
      const entity = this.leadsRepo.create({
        ...dto,
        // Toda planilha fica FORA do painel (não mistura com anúncio). Com time = lead do TIME.
        source: nomeTime ? LeadSource.TIME : LeadSource.PLANILHA,
        ...(nomeTime ? { origem: nomeTime } : {}),
        importLote: importId,
        // Quem subiu fica responsável (senão o lead some da visão do gerente e
        // cai no bolo geral do Diretor). Diretor distribui depois.
        responsavelId: donoColuna ?? (user.role === UserRole.DIRETOR ? undefined : user.id),
        ...(colunaStatus ? { status: colunaStatus } : {}),
        // Lote manda: responsável, coluna e time de origem próprios.
        ...(lote?.responsavelId ? { responsavelId: lote.responsavelId } : {}),
        ...(lote?.status ? { status: lote.status } : {}),
        ...(lote?.dono ? { responsavelId: lote.dono } : {}),
        ...(lote?.origem ? { origem: lote.origem, source: LeadSource.TIME } : {}),
      } as Partial<Lead>);
      leads.push(entity);
    }

    if (leads.length) await this.leadsRepo.save(leads);
    if (leads.length && this.leadsRepo.manager) {
      await this.leadsRepo.manager
        .query(
          `INSERT INTO lead_imports (id, nome, "userId", "userName", total) VALUES ($1, $2, $3, $4, $5)`,
          [importId, (file as any).originalname || "planilha", user.id, user.name ?? "", leads.length]
        )
        .catch((err: any) => this.logger.warn(`Falha ao registrar importação: ${err?.message}`));
    }

    // Quantos entraram em cada lote (pra mostrar no fim).
    let ini = 0;
    const porLote = lotes.map((l) => {
      const n = Math.max(0, Math.min(l.quantidade, leads.length - ini));
      ini += l.quantidade;
      return n;
    });
    return {
      importId: leads.length ? importId : undefined,
      imported: leads.length,
      duplicates,
      semTelefone,
      total: rows.length,
      porLote,
      restante: Math.max(0, leads.length - lotes.reduce((a, l) => a + l.quantidade, 0)),
    };
  }

  /** Planilhas importadas (Diretor vê todas; os cargos, as que eles subiram). */
  async listarImportacoes(user: User) {
    const soMinhas = user.role !== UserRole.DIRETOR;
    const rows: any[] = await this.leadsRepo.manager.query(
      `SELECT i.id, i.nome, i."userName", i.total, i."createdAt",
              (SELECT COUNT(*)::int FROM leads l WHERE l."importLote" = i.id) AS restantes
         FROM lead_imports i
        WHERE i.apagado = false ${soMinhas ? `AND i."userId" = $1` : ""}
        ORDER BY i."createdAt" DESC
        LIMIT 30`,
      soMinhas ? [user.id] : []
    );
    return rows;
  }

  /**
   * Apaga TODOS os leads de uma planilha (subiu errado). Não bloqueia os telefones
   * (dá pra subir de novo). Conversas ficam, só desvinculadas do lead.
   */
  async apagarImportacao(importId: string, user: User) {
    const imp: any[] = await this.leadsRepo.manager.query(`SELECT id, "userId" FROM lead_imports WHERE id = $1`, [importId]);
    if (!imp.length) throw new NotFoundException("Importação não encontrada.");
    if (user.role !== UserRole.DIRETOR && imp[0].userId !== user.id) {
      throw new ForbiddenException("Você só pode apagar as planilhas que você subiu.");
    }
    const ids: string[] = (
      await this.leadsRepo.manager.query(`SELECT id FROM leads WHERE "importLote" = $1`, [importId])
    ).map((r: any) => r.id);
    if (ids.length) {
      const m = this.leadsRepo.manager;
      await m.query(`UPDATE conversations SET "leadId" = NULL WHERE "leadId" = ANY($1)`, [ids]);
      await m.query(`DELETE FROM lead_history WHERE "leadId" = ANY($1)`, [ids]);
      await m.query(`DELETE FROM lead_queue_assignments WHERE "leadId" = ANY($1)`, [ids]);
      await m.query(`DELETE FROM appointments WHERE "leadId" = ANY($1)`, [ids]);
      await m.query(`DELETE FROM leads WHERE id = ANY($1)`, [ids]);
    }
    await this.leadsRepo.manager.query(`UPDATE lead_imports SET apagado = true WHERE id = $1`, [importId]);
    this.logger.log(`Planilha ${importId} apagada por ${user.name}: ${ids.length} lead(s).`);
    return { removidos: ids.length };
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
