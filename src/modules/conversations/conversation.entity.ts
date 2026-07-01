import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from "typeorm";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { Message } from "./message.entity";

@Entity("conversations")
export class Conversation {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ default: "whatsapp" })
  channel: string;

  // Número/identificador remoto no WhatsApp (ex: 5511999998888)
  @Column({ nullable: true })
  remoteJid: string;

  @Column({ nullable: true })
  leadId: string;

  @ManyToOne(() => Lead, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "leadId" })
  lead: Lead;

  // Atendente responsável pela conversa (define a visibilidade por equipe).
  @Column({ nullable: true })
  assignedToId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "assignedToId" })
  assignedTo: User;

  @Column({ type: "text", nullable: true })
  lastMessage: string;

  @Column({ nullable: true })
  lastMessageAt: Date;

  @Column({ type: "int", default: 0 })
  unreadCount: number;

  // Etiquetas da conversa (ex.: agendamento, visita_realizada, venda_ganha).
  // simple-array guarda como texto separado por vírgula.
  @Column({ type: "simple-array", nullable: true })
  etiquetas: string[];

  @OneToMany(() => Message, (m) => m.conversation)
  messages: Message[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
