import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/** Anotação de reunião de 1-on-1 / feedback (individual ou de time). */
@Entity("feedback_notes")
export class FeedbackNote {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // "user" = 1-on-1 com uma pessoa; "time" = reunião com a equipe de um gestor.
  @Column({ type: "varchar", default: "user" })
  alvoTipo: string;

  // Id do alvo: a pessoa (user) ou o gestor dono da equipe (time).
  @Index()
  @Column()
  alvoId: string;

  // Quem escreveu a anotação.
  @Column()
  autorId: string;

  @Column({ type: "text" })
  texto: string;

  @CreateDateColumn()
  createdAt: Date;
}
