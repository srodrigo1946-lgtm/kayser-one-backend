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

  /**
   * Exclui a empresa parceira DE VEZ (só Diretor): solta as pastas atribuídas a ela,
   * remove o usuário de login dela (soltando refs pra não travar FK) e apaga a empresa.
   */
  async remove(id: string, user: User) {
    if (user.role !== UserRole.DIRETOR) {
      throw new ForbiddenException("Apenas o Diretor pode excluir empresas parceiras.");
    }
    const emp = await this.repo.findOne({ where: { id } });
    if (!emp) throw new NotFoundException("Empresa não encontrada.");

    const safe = async (sql: string, params: any[]) => {
      try {
        await this.usersRepo.query(sql, params);
      } catch {
        /* best-effort */
      }
    };
    // Pastas atribuídas a esta empresa ficam sem empresa.
    await safe(`UPDATE analysis_folders SET "empresaId" = NULL WHERE "empresaId" = $1`, [id]);

    // Remove o usuário de login da empresa (soltando referências antes).
    const loginUser = await this.usersRepo.findOne({ where: { empresaId: id } });
    if (loginUser) {
      const uid = loginUser.id;
      const clears: [string, string][] = [
        ["leads", "responsavelId"],
        ["conversations", "assignedToId"],
        ["conversations", "instanceOwnerId"],
        ["analysis_folders", "responsavelId"],
        ["users", "managerId"],
      ];
      for (const [t, c] of clears) await safe(`UPDATE ${t} SET "${c}" = NULL WHERE "${c}" = $1`, [uid]);
      await this.usersRepo.delete({ id: uid });
    }
    await this.repo.delete({ id });
    return { ok: true };
  }

  /**
   * Garante o usuário de login da empresa. Se já existir conta com esse e-mail,
   * VINCULA à empresa e reseta a senha provisória (idempotente e à prova de
   * colisão). Cargo CORRETOR + empresaId (o marcador de "é empresa").
   */
  private async ensureEmpresaLogin(emp: Empresa) {
    const passwordHash = await bcrypt.hash("123456789", 12);
    const existing = await this.usersRepo.findOne({ where: { email: emp.email } });
    const base = {
      name: emp.nome || emp.email,
      email: emp.email,
      passwordHash,
      role: UserRole.CORRETOR,
      empresaId: emp.id,
      firstLogin: true,
      approved: true,
      active: true,
    };
    if (existing) {
      await this.usersRepo.save({ ...existing, ...base });
    } else {
      await this.usersRepo.save(this.usersRepo.create(base));
    }
    return { email: emp.email, senhaProvisoria: "123456789" };
  }
}
