import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

// "aguardando" = lead sem plantão ativo, esperando abrir o próximo turno.
export type AssignmentStatus = "aguardando" | "pendente" | "atendido" | "expirado";

@Entity("lead_queue_assignments")
export class LeadQueueAssignment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column()
  conversationId: string;

  @Column({ nullable: true })
  leadId: string;

  @Column()
  assignedToId: string;

  @CreateDateColumn()
  assignedAt: Date;

  @Index()
  @Column()
  dueAt: Date;

  // Lead AGENDADO: se preenchido, só entra no rodízio a partir deste horário
  // (fica "aguardando" até lá, mesmo com plantão aberto). Null = entra normal.
  @Column({ type: "timestamp", nullable: true })
  agendadoPara: Date | null;

  @Column({ default: "pendente" })
  status: AssignmentStatus;

  @Column({ type: "int", default: 1 })
  attempts: number;
}
