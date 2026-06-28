import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Lead } from "../leads/lead.entity";

export enum LeadHistoryType {
  CRIACAO = "criacao",
  MUDANCA_STATUS = "mudanca_status",
  CONTATO = "contato",
  NOTA = "nota",
  SISTEMA = "sistema",
}

@Entity("lead_history")
export class LeadHistory {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  leadId: string;

  @ManyToOne(() => Lead, { onDelete: "CASCADE" })
  @JoinColumn({ name: "leadId" })
  lead: Lead;

  @Column({ nullable: true })
  userId: string;

  @Column({ type: "enum", enum: LeadHistoryType, default: LeadHistoryType.SISTEMA })
  type: LeadHistoryType;

  @Column({ nullable: true })
  fromStatus: string;

  @Column({ nullable: true })
  toStatus: string;

  @Column({ type: "text" })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}
