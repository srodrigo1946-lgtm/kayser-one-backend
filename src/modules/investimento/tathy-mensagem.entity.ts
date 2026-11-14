import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/** Conversa com a Tathy (Rodrigo 14/11: "grava td"). Imagem não é guardada, só contada. */
@Entity("tathy_mensagens")
export class TathyMensagem {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index()
  @Column({ type: "varchar" })
  userId: string;

  @Column({ type: "varchar" })
  role: string; // "user" | "assistant"

  @Column({ type: "text" })
  texto: string;

  @Column({ type: "int", default: 0 })
  imagens: number;

  @Column({ type: "text", nullable: true })
  links: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
