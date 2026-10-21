import { Injectable, NotFoundException, ForbiddenException } from "@nestjs/common";
import { LeadStatus } from "../leads/lead.entity";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, IsNull, Repository } from "typeorm";
import { Appointment } from "./appointment.entity";
import { User, UserRole } from "../users/user.entity";
import { UsersService } from "../users/users.service";

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>,
    private readonly users: UsersService
  ) {}

  async findAll(user: User, from?: string, to?: string) {
    // Cada cargo vê só a PRÓPRIA agenda (Rodrigo 21/10). O Diretor também vê as
    // visitas sem dono (IA fora do plantão), pra não sumirem antes de ir pro corretor.
    const periodo = from && to ? { scheduledAt: Between(new Date(from), new Date(to)) } : {};
    const where: any[] = [{ ...periodo, userId: user.id }];
    if (user.role === UserRole.DIRETOR) where.push({ ...periodo, userId: IsNull() });

    return this.repo.find({
      where,
      relations: ["lead", "user"],
      order: { scheduledAt: "ASC" },
    });
  }

  /**
   * Ranking por pessoa (com cargo) igual ao Kanban: leads que estão AGORA nas
   * colunas "Agendamento" e "Visita realizada" (Rodrigo 21/10: "está no kanban").
   * Escopo por equipe, como o Kanban: Diretor vê todos, gestor o time, corretor ele.
   */
  async ranking(user: User) {
    const scopeIds = await this.users.getScopeIds(user);
    // Mês e ano de Brasília (UTC-3): o "dia do agendamento" perguntado no Kanban.
    const sp = new Date(Date.now() - 3 * 3_600_000);
    const y = sp.getUTCFullYear();
    const m = sp.getUTCMonth();
    const iniMes = new Date(Date.UTC(y, m, 1, 3));
    const fimMes = new Date(Date.UTC(y, m + 1, 1, 3));
    const iniAno = new Date(Date.UTC(y, 0, 1, 3));
    const fimAno = new Date(Date.UTC(y + 1, 0, 1, 3));
    const rows: any[] = await this.repo.query(
      `SELECT u.id, u.name AS nome, u.role,
         COUNT(l.id) FILTER (WHERE l.status = $1)::int AS agendamentos,
         COUNT(l.id) FILTER (WHERE l.status = $2)::int AS visitas,
         COUNT(l.id) FILTER (WHERE l."dataAgendamento" >= $4 AND l."dataAgendamento" < $5)::int AS "agMes",
         COUNT(l.id) FILTER (WHERE l."dataAgendamento" >= $6 AND l."dataAgendamento" < $7)::int AS "agAno"
       FROM users u JOIN leads l ON l."responsavelId" = u.id
       WHERE ($3::uuid[] IS NULL OR u.id = ANY($3::uuid[]))
       GROUP BY u.id, u.name, u.role`,
      [LeadStatus.AGENDAMENTO, LeadStatus.VISITA_REALIZADA, scopeIds, iniMes, fimMes, iniAno, fimAno]
    );
    return rows
      .filter((r) => r.agendamentos > 0 || r.visitas > 0 || r.agAno > 0)
      .sort((a, b) => b.visitas - a.visitas || b.agendamentos - a.agendamentos || a.nome.localeCompare(b.nome));
  }

  async create(dto: Partial<Appointment>, user: User) {
    const appointment = this.repo.create({
      ...dto,
      userId: dto.userId || user.id,
    });
    await this.assertAlvos(appointment, user);
    return this.repo.save(appointment);
  }

  /** O responsável e o lead do compromisso precisam ser do time de quem grava (auditoria 19/10). */
  private async assertAlvos(a: Partial<Appointment>, user: User) {
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds === null) return; // Diretor
    if (a.userId && !scopeIds.includes(a.userId)) {
      throw new ForbiddenException("O responsável precisa ser do seu time.");
    }
    if (a.leadId) {
      const [lead] = await this.repo.query(`SELECT "responsavelId" FROM leads WHERE id = $1`, [a.leadId]);
      if (!lead || !scopeIds.includes(lead.responsavelId)) {
        throw new ForbiddenException("Esse lead não é do seu time.");
      }
    }
  }

  /** Escopo por equipe: só acessa/edita compromissos do seu time (Diretor tudo). */
  private async assertScope(appointment: Appointment, user?: User) {
    if (!user) return; // chamada interna sem contexto de usuário
    const scopeIds = await this.users.getScopeIds(user);
    if (scopeIds === null) return; // Diretor
    if (!appointment.userId || !scopeIds.includes(appointment.userId)) {
      throw new ForbiddenException("Você não tem acesso a este compromisso.");
    }
  }

  async update(id: string, dto: Partial<Appointment>, user?: User) {
    const appointment = await this.repo.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado.");
    await this.assertScope(appointment, user);
    const { id: _id, createdAt: _c, ...campos } = dto as any;
    Object.assign(appointment, campos);
    if (user) await this.assertAlvos(appointment, user);
    return this.repo.save(appointment);
  }

  async remove(id: string, user?: User) {
    const appointment = await this.repo.findOne({ where: { id } });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado.");
    await this.assertScope(appointment, user);
    await this.repo.remove(appointment);
    return { message: "Agendamento removido." };
  }

  async findOne(id: string, user?: User) {
    const appointment = await this.repo.findOne({ where: { id }, relations: ["lead", "user"] });
    if (!appointment) throw new NotFoundException("Agendamento não encontrado.");
    await this.assertScope(appointment, user);
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
      "PRODID:-//K1//CRM//PT-BR",
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
