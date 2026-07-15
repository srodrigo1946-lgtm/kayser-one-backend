import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import * as XLSX from "xlsx";
import { Pasta } from "./pasta.entity";
import { Lead } from "../leads/lead.entity";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { DocumentsService } from "../documents/documents.service";
import { CreatePastaDto } from "./dto/create-pasta.dto";
import { UpdatePastaDto } from "./dto/update-pasta.dto";

/** Janela de acesso da empresa parceira aos documentos (Fase 5): 40 minutos. */
const WINDOW_MS = 40 * 60 * 1000;

@Injectable()
export class PastasService {
  constructor(
    @InjectRepository(Pasta)
    private readonly repo: Repository<Pasta>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly users: UsersService,
    private readonly documents: DocumentsService
  ) {}

  /** Lista as pastas por hierarquia (Diretor tudo; gestor equipe; corretor as suas). */
  async list(user: User) {
    // Empresa parceira (usuário com empresaId) vê só as pastas atribuídas a ela.
    if (user.empresaId) {
      return this.repo.find({ where: { empresaId: user.empresaId }, order: { createdAt: "DESC" } });
    }
    const scopeIds = await this.users.getScopeIds(user);
    const where = scopeIds === null ? {} : { responsavelId: In(scopeIds) };
    return this.repo.find({ where, order: { createdAt: "DESC" } });
  }

  async create(dto: CreatePastaDto, user: User) {
    const lead = await this.leadsRepo.findOne({ where: { id: dto.leadId } });
    if (!lead) throw new NotFoundException("Cliente não encontrado.");
    // Próximo número da análise (global). max+1 => recomeça em 1 se as pastas forem apagadas.
    const row = await this.repo.query(`SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM analysis_folders`);
    const numero = Number(row?.[0]?.n) || 1;
    const pasta = this.repo.create({
      ...dto,
      numero,
      clientName: lead.name,
      clientCpf: lead.cpf ?? undefined,
      empreendimento: dto.empreendimento ?? lead.empreendimento ?? undefined,
      responsavelId: lead.responsavelId ?? user.id,
      createdById: user.id,
      status: "montando",
    });
    const saved = await this.repo.save(pasta);
    // Cria o ambiente de documentos (reusa DocumentRequest). Tolerante a falha:
    // se der erro, a pasta continua criada e os docs podem ser gerados depois.
    try {
      await this.ensureDocsForPasta(saved, lead, user);
    } catch {
      /* segue sem quebrar a criação da pasta */
    }
    return saved;
  }

  /** Cria (se ainda não houver) o DocumentRequest ligado à pasta e grava o token. */
  private async ensureDocsForPasta(pasta: Pasta, lead: Lead, user: User) {
    if (pasta.docToken) return pasta;
    const req = await this.documents.createRequest(
      {
        clientName: lead.name,
        clientPhone: lead.phone,
        leadId: lead.id,
        fase: pasta.fase || "simplificada",
        // o módulo de docs usa clt|autonomo; empresário ≈ autônomo p/ o checklist.
        perfil: pasta.perfil === "empresario" ? "autonomo" : "clt",
        estadoCivil: lead.estadoCivil || "solteiro",
        declaraIR: false,
      },
      user.id
    );
    pasta.documentRequestId = req.id;
    pasta.docToken = req.token;
    return this.repo.save(pasta);
  }

  /** Garante o ambiente de documentos de uma pasta existente e devolve o token. */
  async ensureDocuments(id: string, user: User) {
    const pasta = await this.getScopedOrFail(id, user);
    if (pasta.docToken) return { token: pasta.docToken };
    const lead = await this.leadsRepo.findOne({ where: { id: pasta.leadId } });
    if (!lead) throw new NotFoundException("Cliente da pasta não encontrado.");
    const updated = await this.ensureDocsForPasta(pasta, lead, user);
    return { token: updated.docToken };
  }

  private async getScopedOrFail(id: string, user: User) {
    const pasta = await this.repo.findOne({ where: { id } });
    if (!pasta) throw new NotFoundException("Pasta não encontrada.");
    if (user.empresaId) {
      if (pasta.empresaId !== user.empresaId) {
        throw new ForbiddenException("Você não tem acesso a esta pasta.");
      }
      return pasta;
    }
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null && !(pasta.responsavelId && scopeIds.includes(pasta.responsavelId))) {
      throw new ForbiddenException("Você não tem acesso a esta pasta.");
    }
    return pasta;
  }

  findOne(id: string, user: User) {
    return this.getScopedOrFail(id, user);
  }

  async update(id: string, dto: UpdatePastaDto, user: User) {
    const pasta = await this.getScopedOrFail(id, user);
    Object.assign(pasta, dto);
    return this.repo.save(pasta);
  }

  async updateStatus(id: string, status: string, user: User) {
    const pasta = await this.getScopedOrFail(id, user);
    // Veredito (complemento/aprovado/reprovado) só o Diretor ou a empresa parceira.
    // Corretor/gestores só movem entre "montando" e "em_analise".
    const veredito = ["complemento", "aprovado", "reprovado"];
    const podeVeredito = !!user.empresaId || user.role === UserRole.DIRETOR;
    if (veredito.includes(status) && !podeVeredito) {
      throw new ForbiddenException(
        "Apenas o Diretor ou a empresa parceira definem o veredito da análise."
      );
    }
    pasta.status = status;
    return this.repo.save(pasta);
  }

  /**
   * Estado da janela de 40 min (Fase 5). Corretor/Diretor sempre têm acesso
   * (janela não se aplica); só a EMPRESA parceira é limitada pela janela.
   */
  private windowInfo(pasta: Pasta) {
    const releasedAt = pasta.docsReleasedAt ? new Date(pasta.docsReleasedAt) : null;
    const expiresAt = releasedAt ? new Date(releasedAt.getTime() + WINDOW_MS) : null;
    const now = Date.now();
    const released = !!releasedAt;
    const active = !!expiresAt && now < expiresAt.getTime();
    const archived = released && !active;
    const remainingMs = active && expiresAt ? expiresAt.getTime() - now : 0;
    return { released, active, archived, remainingMs, releasedAt, expiresAt };
  }

  /** Exclui a pasta (só Diretor) + o ambiente de documentos ligado (evita lixo). */
  async remove(id: string, user: User) {
    if (user.role !== UserRole.DIRETOR) {
      throw new ForbiddenException("Apenas o Diretor pode excluir pastas.");
    }
    const pasta = await this.repo.findOne({ where: { id } });
    if (!pasta) throw new NotFoundException("Pasta não encontrada.");
    if (pasta.documentRequestId) {
      try {
        await this.documents.deleteRequest(pasta.documentRequestId);
      } catch {
        /* segue apagando a pasta mesmo se a limpeza dos docs falhar */
      }
    }
    await this.repo.delete({ id });
    return { ok: true };
  }

  /** Ranking só do Gerente Geral pra cima (gerente de vendas e corretor não veem). */
  private assertCanViewRanking(user: User) {
    const ok: UserRole[] = [UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL];
    if (!ok.includes(user.role)) {
      throw new ForbiddenException("Ranking disponível apenas do Gerente Geral para cima.");
    }
  }

  private periodRange(year?: number, month?: number): { start?: Date; end?: Date } {
    if (!year) return {};
    if (month && month >= 1 && month <= 12) {
      return { start: new Date(year, month - 1, 1), end: new Date(year, month, 1) };
    }
    return { start: new Date(year, 0, 1), end: new Date(year + 1, 0, 1) };
  }

  /**
   * Ranking de Análises: por responsável, nº de análises (pastas), quantas viraram
   * venda (aprovadas) e a taxa de conversão (%). Exclui o Diretor; escopo por hierarquia.
   */
  async analysesRanking(user: User, year?: number, month?: number) {
    this.assertCanViewRanking(user);
    const scope = await this.users.getScopeIds(user);
    const { start, end } = this.periodRange(year, month);
    const qb = this.repo
      .createQueryBuilder("p")
      .innerJoin(User, "u", "u.id = p.responsavelId")
      .select("u.id", "id")
      .addSelect("u.name", "name")
      .addSelect("u.role", "role")
      .addSelect("(u.avatar IS NOT NULL)", "hasAvatar")
      .addSelect("COUNT(p.id)", "analises")
      .addSelect("COUNT(*) FILTER (WHERE p.status = 'aprovado')", "vendas")
      .addSelect("COALESCE(SUM(p.\"valorVendaFinal\") FILTER (WHERE p.status = 'aprovado'), 0)", "vgv")
      .where("u.role != :d", { d: UserRole.DIRETOR })
      .groupBy("u.id")
      .addGroupBy("u.name")
      .addGroupBy("u.role")
      .addGroupBy("u.avatar");
    if (start) qb.andWhere('p."createdAt" >= :start', { start });
    if (end) qb.andWhere('p."createdAt" < :end', { end });
    if (scope !== null) {
      qb.andWhere('p."responsavelId" IN (:...ids)', {
        ids: scope.length ? scope : ["00000000-0000-0000-0000-000000000000"],
      });
    }
    const rows = await qb.getRawMany();
    return rows
      .map((r) => {
        const analises = Number(r.analises) || 0;
        const vendas = Number(r.vendas) || 0;
        return {
          id: r.id,
          name: r.name,
          role: r.role,
          hasAvatar: r.hasAvatar === true || r.hasAvatar === "true",
          analises,
          vendas,
          conversao: analises ? Math.round((vendas / analises) * 100) : 0,
          vgv: Number(r.vgv) || 0,
        };
      })
      .sort((a, b) => b.vendas - a.vendas || b.conversao - a.conversao || b.analises - a.analises);
  }

  /** Exporta as análises em XLSX (só Diretor — evita vazamento de dados de clientes). */
  async exportAnalyses(user: User, year?: number, month?: number): Promise<Buffer> {
    if (user.role !== UserRole.DIRETOR) {
      throw new ForbiddenException("Apenas o Diretor pode exportar as análises.");
    }
    const { start, end } = this.periodRange(year, month);
    const qb = this.repo
      .createQueryBuilder("p")
      .leftJoin(User, "u", "u.id = p.responsavelId")
      .select("p.numero", "numero")
      .addSelect("u.name", "responsavel")
      .addSelect("p.clientName", "cliente")
      .addSelect("p.empreendimento", "empreendimento")
      .addSelect("p.status", "status")
      .addSelect('p."valorVendaFinal"', "valor")
      .addSelect('p."createdAt"', "criadaEm")
      .orderBy("p.numero", "ASC");
    if (start) qb.andWhere('p."createdAt" >= :start', { start });
    if (end) qb.andWhere('p."createdAt" < :end', { end });
    const rows = await qb.getRawMany();
    const LABEL: Record<string, string> = {
      montando: "Montando", em_analise: "Em análise", complemento: "Complemento",
      aprovado: "Aprovado", reprovado: "Reprovado",
    };
    const data = rows.map((r) => ({
      "Análise": r.numero != null ? `Análise ${String(r.numero).padStart(2, "0")}` : "",
      "Responsável": r.responsavel || "",
      "Cliente": r.cliente || "",
      "Empreendimento": r.empreendimento || "",
      "Status": LABEL[r.status] || r.status || "",
      "Valor (R$)": r.valor != null ? Number(r.valor) : "",
      "Criada em": r.criadaEm ? new Date(r.criadaEm).toLocaleString("pt-BR") : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Análises");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  /** Lista os documentos da pasta. Empresa só recebe os arquivos com a janela ATIVA. */
  async listFiles(id: string, user: User) {
    const pasta = await this.getScopedOrFail(id, user);
    const win = this.windowInfo(pasta);
    const isEmpresa = !!user.empresaId;
    const base = pasta.documentRequestId
      ? await this.documents.listFilesByRequestId(pasta.documentRequestId)
      : { request: { clientName: pasta.clientName }, documents: [] as any[] };
    // Empresa sem janela ativa não recebe a listagem dos arquivos (só o estado).
    if (isEmpresa && !win.active) {
      return { request: base.request, documents: [], window: win };
    }
    return { ...base, window: win };
  }

  /** Baixa/visualiza um documento da pasta, garantindo que ele pertence a ela + janela. */
  async getFile(id: string, docId: string, user: User) {
    const pasta = await this.getScopedOrFail(id, user);
    if (user.empresaId && !this.windowInfo(pasta).active) {
      throw new ForbiddenException(
        "Janela de 40 minutos indisponível. Peça ao corretor para liberar os documentos."
      );
    }
    const file = await this.documents.getFileRaw(docId);
    if (!pasta.documentRequestId || file.requestId !== pasta.documentRequestId) {
      throw new ForbiddenException("Documento não pertence a esta pasta.");
    }
    return file;
  }

  /** Libera (ou reabre) a janela de 40 min para a empresa. Só corretor/Diretor. */
  async releaseDocs(id: string, user: User) {
    if (user.empresaId) {
      throw new ForbiddenException("A empresa parceira não libera a própria janela.");
    }
    const pasta = await this.getScopedOrFail(id, user);
    pasta.docsReleasedAt = new Date();
    await this.repo.save(pasta);
    return this.windowInfo(pasta);
  }
}
