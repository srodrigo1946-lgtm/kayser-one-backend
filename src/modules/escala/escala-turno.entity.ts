import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

/** Um turno de plantão na escala semanal (dia da semana × faixa de horário). */
@Entity("escala_turnos")
export class EscalaTurno {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // 0 = Domingo ... 6 = Sábado (igual a Date.getDay()).
  @Column({ type: "int" })
  diaSemana: number;

  // Índice do turno no dia: 0, 1, 2.
  @Column({ type: "int" })
  turno: number;

  @Column({ type: "varchar" })
  horaInicio: string; // "09:00"

  @Column({ type: "varchar" })
  horaFim: string; // "13:00"

  // Atendentes de plantão neste turno (0..N).
  @Column({ type: "simple-array", default: "" })
  atendenteIds: string[];
}
