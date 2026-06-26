import { Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as bcrypt from "bcrypt";
import { User, UserRole } from "./user.entity";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>
  ) {}

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
