import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, In, Repository } from "typeorm";
import { Appointment } from "./appointment.entity";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>,
    private readonly users: UsersService
  ) {}

  async findAll(user: User, from?: string, to?: string) {
    const where: any = {};
    // Escopo por equipe: Diretor (null) vê tudo; demais veem os compromissos do seu time.
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds !== null) where.userId = In(scopeIds);
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

  async findOne(id: string) {
    const appointment = await this.repo.findOne({ where: { id }, relations: ["lead", "user"] });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado.");
    return appointment;
  }

  /** Gera o conteúdo iCalendar (.ics) de um compromisso — importável em Google/Outlook/Apple. */
  buildIcs(a: Appointment): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    const toUtc = (d: Date) => {
      const x = new Date(d);
      return (
        `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}` +
        `T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}${pad(x.getUTCSeconds())}Z`
      );
    };
    const esc = (s?: string) =>
      (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

    const start = new Date(a.scheduledAt);
    const end = new Date(start.getTime() + (a.durationMin || 60) * 60000);

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Kayser One//CRM//PT-BR",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${a.id}@kayserone`,
      `DTSTAMP:${toUtc(new Date())}`,
      `DTSTART:${toUtc(start)}`,
      `DTEND:${toUtc(end)}`,
      `SUMMARY:${esc(a.title)}`,
      `DESCRIPTION:${esc(a.notes)}`,
      `LOCATION:${esc(a.location)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    return lines.join("\r\n");
  }
}
