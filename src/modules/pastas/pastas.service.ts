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
    // Empresa parceira vê só as pastas atribuídas a ela.
    if (user.role === UserRole.EMPRESA) {
      return this.repo.find({ where: { empresaId: user.empresaId }, order: { createdAt: "DESC" } });
    }
    const scopeIds = await this.users.getScopeIds(user);
    const where = scopeIds === null ? {} : { responsavelId: In(scopeIds) };
    return this.repo.find({ where, order: { createdAt: "DESC" } });
  }

  async create(dto: CreatePastaDto, user: User) {
    const lead = await this.leadsRepo.findOne({ where: { id: dto.leadId } });
    if (!lead) throw new NotFoundException("Cliente não encontrado.");
    const pasta = this.repo.create({
      ...dto,
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
    if (user.role === UserRole.EMPRESA) {
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
    pasta.status = status;
    return this.repo.save(pasta);
  }
}
