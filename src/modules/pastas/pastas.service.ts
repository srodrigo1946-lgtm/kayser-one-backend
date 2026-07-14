import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In } from "typeorm";
import { Pasta } from "./pasta.entity";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";
import { CreatePastaDto } from "./dto/create-pasta.dto";
import { UpdatePastaDto } from "./dto/update-pasta.dto";

@Injectable()
export class PastasService {
  constructor(
    @InjectRepository(Pasta)
    private readonly repo: Repository<Pasta>,
    @InjectRepository(Lead)
    private readonly leadsRepo: Repository<Lead>,
    private readonly users: UsersService
  ) {}

  /** Lista as pastas por hierarquia (Diretor tudo; gestor equipe; corretor as suas). */
  async list(user: User) {
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
    return this.repo.save(pasta);
  }

  private async getScopedOrFail(id: string, user: User) {
    const pasta = await this.repo.findOne({ where: { id } });
    if (!pasta) throw new NotFoundException("Pasta não encontrada.");
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
