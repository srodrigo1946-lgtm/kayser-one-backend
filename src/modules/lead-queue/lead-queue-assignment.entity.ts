import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

export type AssignmentStatus = "pendente" | "atendido" | "expirado";

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

  @Column({ default: "pendente" })
  status: AssignmentStatus;

  @Column({ type: "int", default: 1 })
  attempts: number;
}
