import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { randomBytes } from "crypto";
import { Meeting } from "./meeting.entity";
import { Appointment, AppointmentType } from "../appointments/appointment.entity";
import { User } from "../users/user.entity";
import { UsersService } from "../users/users.service";

const JITSI_BASE = "https://meet.jit.si";

@Injectable()
export class MeetingsService {
  constructor(
    @InjectRepository(Meeting)
    private readonly repo: Repository<Meeting>,
    @InjectRepository(Appointment)
    private readonly apptRepo: Repository<Appointment>,
    private readonly users: UsersService
  ) {}

  private link(m: Meeting) {
    return `${JITSI_BASE}/${m.roomName}`;
  }
  private withLink(m: Meeting) {
    return { ...m, link: this.link(m) };
  }

  async create(
    dto: { title: string; scheduledAt: string; durationMin?: number; participantIds?: string[] },
    user: User
  ) {
    const roomName = "kayser-" + randomBytes(9).toString("hex");
    const saved = await this.repo.save(
      this.repo.create({
        title: dto.title,
        roomName,
        scheduledAt: new Date(dto.scheduledAt),
        durationMin: dto.durationMin ?? 90,
        hostId: user.id,
        participantIds: dto.participantIds ?? [],
        status: "agendada",
      })
    );
    // Trava o horário na Agenda do CRM (compromisso do tipo reunião).
    try {
      const appt = await this.apptRepo.save(
        this.apptRepo.create({
          title: `Reunião: ${dto.title}`,
          type: AppointmentType.REUNIAO,
          scheduledAt: saved.scheduledAt,
          durationMin: saved.durationMin,
          userId: user.id,
          location: this.link(saved),
        })
      );
      saved.appointmentId = appt.id;
      await this.repo.save(saved);
    } catch {
      /* agenda é best-effort */
    }
    return this.withLink(saved);
  }

  async findAll(user: User) {
    const scopeIds = await this.users.getScopeIds(user);
    const qb = this.repo.createQueryBuilder("m").orderBy("m.scheduledAt", "DESC");
    if (scopeIds !== null) {
      // Vê as reuniões da própria equipe (host) OU aquelas em que é participante.
      qb.where(
        "(m.hostId IN (:...ids) OR (',' || COALESCE(m.participantIds, '') || ',') LIKE :me)",
        { ids: scopeIds, me: `%,${user.id},%` }
      );
    }
    const rows = await qb.getMany();
    return rows.map((m) => this.withLink(m));
  }

  async findOne(id: string) {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException("Reunião não encontrada.");
    return this.withLink(m);
  }

  async update(id: string, dto: Partial<Meeting>) {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException("Reunião não encontrada.");
    Object.assign(m, dto);
    const saved = await this.repo.save(m);
    // Mantém a Agenda em sincronia (horário/título/duração).
    if (saved.appointmentId) {
      try {
        await this.apptRepo.update(saved.appointmentId, {
          title: `Reunião: ${saved.title}`,
          scheduledAt: saved.scheduledAt,
          durationMin: saved.durationMin,
        });
      } catch {
        /* best-effort */
      }
    }
    return this.withLink(saved);
  }

  async setNotes(id: string, notes: string) {
    const r = await this.repo.update(id, { notes });
    if (!r.affected) throw new NotFoundException("Reunião não encontrada.");
    return { ok: true };
  }

  async remove(id: string) {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException("Reunião não encontrada.");
    if (m.appointmentId) {
      try {
        await this.apptRepo.delete(m.appointmentId);
      } catch {
        /* best-effort */
      }
    }
    await this.repo.delete(id);
    return { message: "Reunião cancelada." };
  }
}
