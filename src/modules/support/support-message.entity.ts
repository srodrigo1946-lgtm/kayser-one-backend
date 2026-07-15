import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

/** Mensagem enviada pela caixinha pública de suporte/reclamação (tela de login). */
@Entity("support_messages")
export class SupportMessage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ nullable: true })
  email: string;

  // suporte | reclamacao
  @Column({ default: "suporte" })
  type: string;

  @Column({ type: "text" })
  message: string;

  @Column({ default: false })
  read: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
