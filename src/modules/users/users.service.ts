import { Injectable, NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User, UserRole } from "./user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { StorageService } from "../storage/storage.service";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly storage: StorageService
  ) {}

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
    const { passwordHash, ...rest } = saved as any;
    return rest;
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

  async findAll(requestingUser: User) {
    // Diretor sees everyone; others see their team
    if (requestingUser.role === UserRole.DIRETOR) {
      return this.usersRepo.find({ relations: ["manager"], order: { role: "ASC", name: "ASC" } });
    }
    return this.usersRepo.find({
      where: { managerId: requestingUser.id },
      relations: ["manager"],
      order: { role: "ASC", name: "ASC" },
    });
  }

  async findOne(id: string) {
    const user = await this.usersRepo.findOne({ where: { id }, relations: ["manager", "subordinates"] });
    if (!user) throw new NotFoundException("Usuário não encontrado.");
    const { passwordHash, ...rest } = user as any;
    return rest;
  }

  async create(dto: CreateUserDto, creator: User) {
    const exists = await this.usersRepo.findOne({ where: { email: dto.email } });
    if (exists) throw new ConflictException("E-mail já cadastrado.");

    const passwordHash = await bcrypt.hash("123456789", 12);
    const user = this.usersRepo.create({ ...dto, passwordHash, firstLogin: true });
    const saved = await this.usersRepo.save(user);
    const { passwordHash: _, ...rest } = saved as any;
    return rest;
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
    const { passwordHash, ...rest } = saved as any;
    return rest;
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.usersRepo.findOneOrFail({ where: { id } });
    Object.assign(user, dto);
    const saved = await this.usersRepo.save(user);
    const { passwordHash, ...rest } = saved as any;
    return rest;
  }

  async deactivate(id: string) {
    const user = await this.usersRepo.findOneOrFail({ where: { id } });
    user.active = false;
    await this.usersRepo.save(user);
    return { message: "Usuário desativado." };
  }
}
