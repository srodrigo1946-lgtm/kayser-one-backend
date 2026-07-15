import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
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
