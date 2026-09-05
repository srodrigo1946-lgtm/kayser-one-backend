import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { EscalaTurno } from "./escala-turno.entity";

// Seg-Sex e Sáb-Dom têm faixas diferentes (decisão do Rodrigo).
const SEMANA: [string, string][] = [["09:00", "13:00"], ["13:00", "17:00"], ["17:00", "21:00"]];
const FDS: [string, string][] = [["09:00", "12:00"], ["12:00", "15:00"], ["15:00", "18:00"]];

@Injectable()
export class EscalaService implements OnModuleInit {
  constructor(
    @InjectRepository(EscalaTurno)
    private readonly repo: Repository<EscalaTurno>
  ) {}

  async onModuleInit() {
    // Best-effort: se a tabela ainda não existe no boot, o schema-bootstrap cria;
    // o seed roda sem quebrar a subida.
    try {
      await this.seedIfEmpty();
    } catch {
      /* tabela ainda não pronta — semeia no próximo boot */
    }
  }

  /** Cria os 21 turnos (7 dias × 3) com os horários padrão, se a grade estiver vazia. */
  async seedIfEmpty() {
    if ((await this.repo.count()) > 0) return;
    const rows: EscalaTurno[] = [];
    for (let d = 0; d <= 6; d++) {
      const horarios = d === 0 || d === 6 ? FDS : SEMANA;
      horarios.forEach(([hi, hf], t) =>
        rows.push(this.repo.create({ diaSemana: d, turno: t, horaInicio: hi, horaFim: hf, atendenteIds: [] }))
      );
    }
    await this.repo.save(rows);
  }

  getGrade() {
    return this.repo.find({ order: { diaSemana: "ASC", turno: "ASC" } });
  }

  // Dia/hora do plantão são SEMPRE em horário de Brasília — não podem depender do
  // TZ do servidor (Railway roda em UTC), senão os turnos rodam 3h adiantados.
  private static readonly DIAS: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  private static readonly FMT = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  /**
   * Turno de plantão ativo no instante `now` (ou null se ninguém está de plantão).
   * A comparação de "HH:MM" é lexicográfica — funciona porque é zero-padded.
   * O fim é exclusivo: 13:00 já pertence ao turno da tarde, não ao da manhã.
   */
  async turnoAtivo(now: Date): Promise<EscalaTurno | null> {
    const p = Object.fromEntries(
      EscalaService.FMT.formatToParts(now).map((x) => [x.type, x.value])
    );
    const dia = EscalaService.DIAS[p.weekday];
    const hh = p.hour === "24" ? "00" : p.hour; // Intl pode devolver "24" à meia-noite
    const hhmm = `${hh}:${p.minute}`;
    const turnos = await this.repo.find({ where: { diaSemana: dia } });
    return turnos.find((t) => t.horaInicio <= hhmm && hhmm < t.horaFim) ?? null;
  }

  async setAtendentes(id: string, atendenteIds: string[]): Promise<EscalaTurno> {
    const turno = await this.repo.findOne({ where: { id } });
    if (!turno) throw new NotFoundException("Turno não encontrado.");
    turno.atendenteIds = atendenteIds;
    return this.repo.save(turno);
  }
}
