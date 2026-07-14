import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { Empresa } from "./empresa.entity";
import { User, UserRole } from "../users/user.entity";

@Injectable()
export class EmpresasService {
  constructor(
    @InjectRepository(Empresa)
    private readonly repo: Repository<Empresa>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>
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

  /**
   * Liberação/reprovação é só do Diretor. Ao aprovar, cria o LOGIN da empresa
   * (usuário cargo EMPRESA, senha provisória padrão) e devolve as credenciais
   * para o Diretor repassar — só na primeira vez (quando o usuário é criado).
   */
  async setStatus(id: string, status: string, user: User) {
    if (user.role !== UserRole.DIRETOR) {
      throw new ForbiddenException("Apenas o Diretor libera empresas parceiras.");
    }
    const emp = await this.repo.findOne({ where: { id } });
    if (!emp) throw new NotFoundException("Empresa não encontrada.");
    emp.status = status;
    const saved = await this.repo.save(emp);
    let credenciais: { email: string; senhaProvisoria: string } | undefined;
    if (status === "aprovada") {
      credenciais = await this.ensureEmpresaLogin(saved);
    }
    return { ...saved, credenciais };
  }

  /** Cria o usuário de login da empresa (se ainda não existir com esse e-mail). */
  private async ensureEmpresaLogin(emp: Empresa) {
    const existing = await this.usersRepo.findOne({ where: { email: emp.email } });
    if (existing) return undefined; // já há conta com esse e-mail — não recria/reexibe
    const passwordHash = await bcrypt.hash("123456789", 12);
    await this.usersRepo.save(
      this.usersRepo.create({
        name: emp.nome || emp.email,
        email: emp.email,
        passwordHash,
        // Cargo válido do enum; o que marca "é empresa parceira" é o empresaId
        // (evita depender de ALTER TYPE no enum do Postgres).
        role: UserRole.CORRETOR,
        empresaId: emp.id,
        firstLogin: true,
        approved: true,
        active: true,
      })
    );
    return { email: emp.email, senhaProvisoria: "123456789" };
  }
}
