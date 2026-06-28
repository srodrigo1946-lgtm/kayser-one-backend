import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum KnowledgeType {
  FAQ = "faq",
  PRODUTO = "produto",
  EMPREENDIMENTO = "empreendimento",
  SCRIPT = "script",
  NORMA = "norma",
  TABELA = "tabela",
  OUTRO = "outro",
}

/**
 * Item da base de conhecimento usada pela IA.
 * Cada item é um trecho de texto autorizado (FAQ, produto, script, etc).
 */
@Entity("knowledge_items")
export class KnowledgeItem {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  title: string;

  @Column({ type: "text" })
  content: string;

  @Column({ type: "enum", enum: KnowledgeType, default: KnowledgeType.OUTRO })
  type: KnowledgeType;

  @Column({ default: true })
  active: boolean;

  // Chave do arquivo original no MinIO (quando enviado por upload).
  @Column({ nullable: true })
  fileKey: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
