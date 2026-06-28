import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";

export enum AppointmentType {
  VISITA = "visita",
  REUNIAO = "reuniao",
  TAREFA = "tarefa",
  LEMBRETE = "lembrete",
}

export enum AppointmentStatus {
  AGENDADO = "agendado",
  REALIZADO = "realizado",
  CANCELADO = "cancelado",
}

@Entity("appointments")
export class Appointment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  title: string;

  @Column({ type: "enum", enum: AppointmentType, default: AppointmentType.VISITA })
  type: AppointmentType;

  @Column({ type: "enum", enum: AppointmentStatus, default: AppointmentStatus.AGENDADO })
  status: AppointmentStatus;

  @Column()
  scheduledAt: Date;

  @Column({ type: "int", default: 60 })
  durationMin: number;

  @Column({ nullable: true })
  location: string;

  @Column({ type: "text", nullable: true })
  notes: string;

  @Column({ nullable: true })
  leadId: string;

  @ManyToOne(() => Lead, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "leadId" })
  lead: Lead;

  @Column({ nullable: true })
  userId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "userId" })
  user: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
