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

  // Mídia (imagem/áudio/vídeo/documento) recebida do WhatsApp.
  @Column({ type: "varchar", nullable: true })
  mediaType: string;

  @Column({ type: "varchar", nullable: true })
  mediaMime: string;

  // Chave no R2 (S3) ou data URI (fallback) do arquivo de mídia.
  @Column({ type: "text", nullable: true })
  mediaKey: string;

  @CreateDateColumn()
  createdAt: Date;
}
