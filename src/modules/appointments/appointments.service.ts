import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { Appointment } from "./appointment.entity";
import { User, UserRole } from "../users/user.entity";

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>
  ) {}

  async findAll(user: User, from?: string, to?: string) {
    const where: any = {};
    if (user.role === UserRole.CORRETOR) where.userId = user.id;
    if (from && to) where.scheduledAt = Between(new Date(from), new Date(to));

    return this.repo.find({
      where,
      relations: ["lead", "user"],
      order: { scheduledAt: "ASC" },
    });
  }

  create(dto: Partial<Appointment>, user: User) {
    const appointment = this.repo.create({
      ...dto,
      userId: dto.userId || user.id,
    });
    return this.repo.save(appointment);
  }

  async update(id: string, dto: Partial<Appointment>) {
    const appointment = await this.repo.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado.");
    Object.assign(appointment, dto);
    return this.repo.save(appointment);
  }

  async remove(id: string) {
    const appointment = await this.repo.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado.");
    await this.repo.remove(appointment);
    return { message: "Agendamento removido." };
  }
}
