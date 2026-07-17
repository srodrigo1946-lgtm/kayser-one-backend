import { Injectable, UnauthorizedException, BadRequestException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User, UserRole } from "../users/user.entity";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { RegisterDto } from "./dto/register.dto";

/** Mapa cargo → cargo do gestor imediatamente acima (para o autocadastro). */
const PARENT_ROLE: Partial<Record<UserRole, UserRole>> = {
  [UserRole.SUPERINTENDENTE]: UserRole.DIRETOR,
  [UserRole.GERENTE_GERAL]: UserRole.SUPERINTENDENTE,
  [UserRole.GERENTE]: UserRole.GERENTE_GERAL,
  [UserRole.CORRETOR]: UserRole.GERENTE,
};

const ROLE_LABEL: Record<UserRole, string> = {
  [UserRole.DIRETOR]: "Diretor",
  [UserRole.SUPERINTENDENTE]: "Superintendente",
  [UserRole.GERENTE_GERAL]: "Gerente Geral",
  [UserRole.GERENTE]: "Gerente",
  [UserRole.CORRETOR]: "Corretor",
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly jwtService: JwtService
  ) {}

  /**
   * Lista os possíveis gestores para um cargo em autocadastro: o cargo do nível
   * acima (hierarquia correta) MAIS o Diretor como opção de fallback — assim
   * ninguém fica travado se o chefe direto ainda não se cadastrou (o Diretor
   * pode reassociar o chefe correto depois, na tela de Usuários).
   */
  async listManagers(role: UserRole) {
    const parent = PARENT_ROLE[role];
    if (!parent) return [];
    // Cargos aceitos como gestor: o pai direto + o Diretor (fallback), sem duplicar.
    const roles = parent === UserRole.DIRETOR ? [UserRole.DIRETOR] : [parent, UserRole.DIRETOR];
    const users = await this.usersRepo.find({
      where: { role: In(roles), active: true },
      order: { role: "ASC", name: "ASC" },
    });
    return users.map((u) => ({ id: u.id, name: u.name, role: u.role }));
  }

  /** Autocadastro de um novo usuário, vinculando ao gestor escolhido. */
  async register(dto: RegisterDto) {
    const parent = PARENT_ROLE[dto.role];
    if (!parent) {
      throw new BadRequestException("Cargo inválido para autocadastro (o Diretor já existe).");
    }
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new BadRequestException("E-mail já cadastrado.");

    // Aceita o gestor do nível acima OU o Diretor (fallback p/ não travar o cadastro).
    const allowed = parent === UserRole.DIRETOR ? [UserRole.DIRETOR] : [parent, UserRole.DIRETOR];
    const manager = await this.usersRepo.findOne({ where: { id: dto.managerId } });
    if (!manager || !allowed.includes(manager.role)) {
      throw new BadRequestException(`Selecione um(a) ${ROLE_LABEL[parent]} ou o Diretor como gestor.`);
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.usersRepo.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      role: dto.role,
      managerId: dto.managerId,
      firstLogin: false,
      active: true,
      approved: false, // pendente até o gestor aprovar
    });
    await this.usersRepo.save(user);

    return {
      pending: true,
      message: `Cadastro enviado! Aguarde a aprovação do seu ${ROLE_LABEL[manager.role]} (${manager.name}) para acessar.`,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersRepo.findOne({ where: { email: dto.email, active: true } });
    if (!user) throw new UnauthorizedException("Credenciais inválidas.");

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("Credenciais inválidas.");

    if (!user.approved) {
      throw new UnauthorizedException("Seu cadastro está aguardando aprovação do seu gestor.");
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.sanitize(user),
      firstLogin: user.firstLogin,
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersRepo.findOneOrFail({ where: { id: userId } });
    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!valid) throw new BadRequestException("Senha atual incorreta.");

    user.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    user.firstLogin = false;
    await this.usersRepo.save(user);
    return { message: "Senha alterada com sucesso." };
  }

  async refresh(user: User) {
    const payload = { sub: user.id, email: user.email, role: user.role };
    return { accessToken: this.jwtService.sign(payload) };
  }

  /** Diretor define/atualiza seu código de recuperação (guardado com hash). */
  async setRecoveryCode(userId: string, code: string) {
    const user = await this.usersRepo.findOneOrFail({ where: { id: userId } });
    if (user.role !== UserRole.DIRETOR) {
      throw new BadRequestException("Apenas o Diretor usa código de recuperação.");
    }
    user.recoveryCodeHash = await bcrypt.hash(code, 12);
    await this.usersRepo.save(user);
    return { message: "Código de recuperação salvo." };
  }

  /**
   * Recuperação self-service do Diretor: e-mail + código de recuperação → define nova senha.
   * Erros genéricos (não revela se o e-mail existe / é Diretor / tem código).
   */
  async recover(dto: { email: string; recoveryCode: string; newPassword: string }) {
    const genericError = new UnauthorizedException("E-mail ou código de recuperação inválido.");
    const user = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (!user || user.role !== UserRole.DIRETOR || !user.recoveryCodeHash) throw genericError;
    const ok = await bcrypt.compare(dto.recoveryCode, user.recoveryCodeHash);
    if (!ok) throw genericError;

    user.passwordHash = await bcrypt.hash(dto.newPassword, 12);
    user.firstLogin = false;
    await this.usersRepo.save(user);
    return { message: "Senha redefinida com sucesso. Faça login com a nova senha." };
  }

  sanitize(user: User) {
    const { passwordHash, aiApiKey, recoveryCodeHash, ...rest } = user as any;
    return rest;
  }
}
