import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from "typeorm";
import { KnowledgeItem } from "./knowledge.entity";

/**
 * Pedaço (chunk) de um item da base de conhecimento, com seu vetor de embedding.
 * O embedding é guardado como JSON (number[]) — sem necessidade de extensão pgvector.
 */
@Entity("knowledge_chunks")
export class KnowledgeChunk {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  knowledgeItemId: string;

  @ManyToOne(() => KnowledgeItem, { onDelete: "CASCADE" })
  @JoinColumn({ name: "knowledgeItemId" })
  item: KnowledgeItem;

  @Column({ type: "text" })
  content: string;

  // Vetor de embedding (null quando não foi possível gerar — cai para busca por palavra-chave).
  @Column({ type: "simple-json", nullable: true })
  embedding: number[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
