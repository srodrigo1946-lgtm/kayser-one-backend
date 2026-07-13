import { Injectable, NotFoundException, ConflictException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User, UserRole } from "./user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { StorageService } from "../storage/storage.service";
import { descendantIds } from "../../common/hierarchy";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly storage: StorageService
  ) {}

  // Campos sensíveis que NUNCA podem sair para o front.
  private static readonly SENSITIVE = ["passwordHash", "aiApiKey", "recoveryCodeHash"];

  /** Remove campos sensíveis do usuário e das relações aninhadas (manager/subordinates). */
  private clean(u: any): any {
    if (!u || typeof u !== "object") return u;
    const copy: any = { ...u };
    for (const f of UsersService.SENSITIVE) delete copy[f];
    if (copy.manager) copy.manager = this.clean(copy.manager);
    if (Array.isArray(copy.subordinates)) copy.subordinates = copy.subordinates.map((s) => this.clean(s));
    return copy;
  }

  private cleanMany(list: any[]): any[] {
    return list.map((u) => this.clean(u));
  }

  /** Config de IA do próprio usuário (sem expor a chave). */
  async getMyAi(userId: string) {
    const u = await this.usersRepo.findOneOrFail({ where: { id: userId } });
    return { aiProvider: u.aiProvider ?? null, aiModel: u.aiModel ?? null, hasAiKey: !!u.aiApiKey };
  }

  /** Salva a IA do próprio usuário. Chave vazia mantém a atual; "__clear__" remove. */
  async updateMyAi(userId: string, dto: { aiProvider?: string; aiModel?: string; aiApiKey?: string }) {
    const u = await this.usersRepo.findOneOrFail({ where: { id: userId } });
    if (dto.aiProvider !== undefined) u.aiProvider = dto.aiProvider || null;
    if (dto.aiModel !== undefined) u.aiModel = dto.aiModel || null;
    if (dto.aiApiKey === "__clear__") u.aiApiKey = null;
    else if (dto.aiApiKey) u.aiApiKey = dto.aiApiKey;
    await this.usersRepo.save(u);
    return this.getMyAi(userId);
  }

  /** Define a foto de perfil a partir de um arquivo enviado (MinIO; fallback data URI). */
  async setAvatar(userId: string, file: Express.Multer.File) {
    if (!file) throw new BadRequestException("Nenhum arquivo enviado.");
    if (!file.mimetype?.startsWith("image/")) throw new BadRequestException("Envie um arquivo de imagem.");

    const user = await this.usersRepo.findOneOrFail({ where: { id: userId } });

    if (this.storage.isEnabled) {
      const ext = (file.originalname?.split(".").pop() || "jpg").toLowerCase();
      const key = `avatars/${userId}-${Date.now()}.${ext}`;
      const stored = await this.storage.upload(key, file.buffer, file.mimetype);
      user.avatar = stored || `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    } else {
      // Sem MinIO configurado: guarda a imagem embutida (data URI) para não bloquear o uso.
      user.avatar = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
    }
    const saved = await this.usersRepo.save(user);
    return this.clean(saved);
  }

  /** Retorna os bytes da foto de perfil (de data URI ou do MinIO), ou null. */
  async getAvatar(userId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user?.avatar) return null;

    if (user.avatar.startsWith("data:")) {
      const match = user.avatar.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) return null;
      return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
    }
    return this.storage.getObject(user.avatar);
  }

  /**
   * Ids do usuário + todos os descendentes na árvore de gestão.
   * Carrega a lista mínima (id/managerId) e calcula em memória.
   */
  async getDescendantIds(userId: string): Promise<string[]> {
    const all = await this.usersRepo.find({ select: ["id", "managerId"] });
    return descendantIds(all, userId);
  }

  /**
   * Define o escopo de visibilidade de dados (responsavelId/userId) do usuário:
   * - Diretor: null (sem restrição — vê a empresa toda)
   * - Corretor: apenas ele mesmo
   * - Demais gestores: ele + toda a sua equipe (descendentes)
   */
  async getScopeIds(user: User): Promise<string[] | null> {
    if (user.role === UserRole.DIRETOR) return null;
    if (user.role === UserRole.CORRETOR) return [user.id];
    return this.getDescendantIds(user.id);
  }

  async findAll(requestingUser: User) {
    // Diretor vê todos; os demais veem toda a sua equipe (árvore de descendentes).
    if (requestingUser.role === UserRole.DIRETOR) {
      return this.cleanMany(
        await this.usersRepo.find({ relations: ["manager"], order: { role: "ASC", name: "ASC" } })
      );
    }
    const ids = (await this.getDescendantIds(requestingUser.id)).filter(
      (id) => id !== requestingUser.id
    );
    if (ids.length === 0) return [];
    return this.cleanMany(
      await this.usersRepo.find({
        where: { id: In(ids) },
        relations: ["manager"],
        order: { role: "ASC", name: "ASC" },
      })
    );
  }

  async findOne(id: string) {
    const user = await this.usersRepo.findOne({ where: { id }, relations: ["manager", "subordinates"] });
    if (!user) throw new NotFoundException("Usuário não encontrado.");
    return this.clean(user);
  }

  async create(dto: CreateUserDto, creator: User) {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException("E-mail já cadastrado.");

    const passwordHash = await bcrypt.hash("123456789", 12);
    const user = this.usersRepo.create({ ...dto, passwordHash, firstLogin: true });
    const saved = await this.usersRepo.save(user);
    return this.clean(saved);
  }

  /** Atualização do próprio perfil — apenas campos pessoais (não troca papel/e-mail/foto). */
  async updateSelf(
    userId: string,
    dto: { name?: string; phone?: string; whatsapp?: string }
  ) {
    const user = await this.usersRepo.findOneOrFail({ where: { id: userId } });
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.phone !== undefined) user.phone = dto.phone;
    if (dto.whatsapp !== undefined) user.whatsapp = dto.whatsapp;
    const saved = await this.usersRepo.save(user);
    return this.clean(saved);
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOneOrFail({ where: { id } });
    Object.assign(user, dto);
    const saved = await this.usersRepo.save(user);
    return this.clean(saved);
  }

  async deactivate(id: string, requester: User) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException("Usuário não encontrado.");
    // Cada gestor só pode desativar alguém da própria equipe (Diretor pode todos).
    await this.assertCanManage(user, requester);
    user.active = false;
    await this.usersRepo.save(user);
    return { message: "Usuário desativado." };
  }

  async activate(id: string, requester: User) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException("Usuário não encontrado.");
    await this.assertCanManage(user, requester);
    user.active = true;
    await this.usersRepo.save(user);
    return { message: "Usuário ativado." };
  }

  /** Redefine a senha de alguém da equipe para a padrão, forçando troca no próximo acesso. */
  async resetPassword(id: string, requester: User) {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException("Usuário não encontrado.");
    await this.assertCanManage(user, requester);
    user.passwordHash = await bcrypt.hash("123456789", 12);
    user.firstLogin = true;
    await this.usersRepo.save(user);
    return {
      message: "Senha redefinida para a padrão (123456789). O usuário deverá criar uma nova no próximo acesso.",
    };
  }

  /** Garante que o solicitante pode gerenciar o usuário-alvo (Diretor ou gestor dele). */
  private async assertCanManage(target: User, requester: User) {
    if (requester.role === UserRole.DIRETOR) return;
    const ids = await this.getDescendantIds(requester.id);
    if (target.id === requester.id || !ids.includes(target.id)) {
      throw new ForbiddenException("Você não pode gerenciar este usuário.");
    }
  }

  /** Autocadastros aguardando aprovação, dentro do escopo do solicitante. */
  async findPending(requester: User) {
    if (requester.role === UserRole.DIRETOR) {
      return this.cleanMany(
        await this.usersRepo.find({
          where: { approved: false },
          relations: ["manager"],
          order: { createdAt: "ASC" },
        })
      );
    }
    const ids = (await this.getDescendantIds(requester.id)).filter((id) => id !== requester.id);
    if (ids.length === 0) return [];
    return this.cleanMany(
      await this.usersRepo.find({
        where: { id: In(ids), approved: false },
        relations: ["manager"],
        order: { createdAt: "ASC" },
      })
    );
  }

  async approve(id: string, requester: User) {
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new NotFoundException("Usuário não encontrado.");
    await this.assertCanManage(target, requester);
    target.approved = true;
    const saved = await this.usersRepo.save(target);
    return this.clean(saved);
  }

  async reject(id: string, requester: User) {
    const target = await this.usersRepo.findOne({ where: { id } });
    if (!target) throw new NotFoundException("Usuário não encontrado.");
    await this.assertCanManage(target, requester);
    await this.usersRepo.remove(target);
    return { message: "Cadastro recusado e removido." };
  }
}
