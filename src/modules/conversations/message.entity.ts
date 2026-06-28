import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Conversation } from "./conversation.entity";

export type MessageDirection = "in" | "out";

@Entity("messages")
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  conversationId: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: "CASCADE" })
  @JoinColumn({ name: "conversationId" })
  conversation: Conversation;

  @Column({ type: "text" })
  content: string;

  // "in" = recebida do cliente | "out" = enviada (corretor ou IA)
  @Column({ type: "varchar", default: "in" })
  direction: MessageDirection;

  @Column({ default: false })
  isAI: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
