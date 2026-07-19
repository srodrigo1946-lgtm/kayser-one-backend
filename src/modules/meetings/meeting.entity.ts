import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("meetings")
export class Meeting {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  title: string;

  // Nome da sala no Jitsi (único e difícil de adivinhar). Link = https://meet.jit.si/<roomName>
  @Column()
  roomName: string;

  @Column({ type: "timestamp" })
  scheduledAt: Date;

  @Column({ type: "int", default: 90 })
  durationMin: number;

  // Anotações escritas da reunião (autosave).
  @Column({ type: "text", nullable: true })
  notes: string;

  // agendada | em_andamento | encerrada
  @Column({ default: "agendada" })
  status: string;

  // Dono/anfitrião (quem criou).
  @Column()
  hostId: string;

  // Participantes internos (ids de usuários do CRM).
  @Column({ type: "simple-array", nullable: true })
  participantIds: string[];

  // Compromisso vinculado na Agenda (trava o horário).
  @Column({ nullable: true })
  appointmentId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
