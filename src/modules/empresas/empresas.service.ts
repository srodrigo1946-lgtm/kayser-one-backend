import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Empresa } from "./empresa.entity";
import { User, UserRole } from "../users/user.entity";

@Injectable()
export class EmpresasService {
  constructor(
    @InjectRepository(Empresa)
    private readonly repo: Repository<Empresa>
  ) {}

  /** Diretor vê todas; os demais só as aprovadas (para atribuir à pasta). */
  async list(user: User) {
    if (user.role === UserRole.DIRETOR) {
      return this.repo.find({ order: { createdAt: "DESC" } });
    }
    return this.repo.find({ where: { status: "aprovada" }, order: { nome: "ASC" } });
  }

  create(data: Partial<Empresa>, user: User) {
    const emp = this.repo.create({
      cnpj: data.cnpj,
      email: data.email,
      nome: data.nome,
      status: "pendente",
      createdById: user.id,
    });
    return this.repo.save(emp);
  }

  /** Liberação/reprovação é só do Diretor. */
  async setStatus(id: string, status: string, user: User) {
    if (user.role !== UserRole.DIRETOR) {
      throw new ForbiddenException("Apenas o Diretor libera empresas parceiras.");
    }
    const emp = await this.repo.findOne({ where: { id } });
    if (!emp) throw new NotFoundException("Empresa não encontrada.");
    emp.status = status;
    return this.repo.save(emp);
  }
}
