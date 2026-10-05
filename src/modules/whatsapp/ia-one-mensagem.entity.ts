import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/** Conversa da IA One (número próprio, só pra equipe: corretores/gestores). */
@Entity("ia_one_mensagens")
@Index(["phone", "createdAt"])
export class IaOneMensagem {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Telefone (só dígitos) de quem falou com a IA One.
  @Column()
  phone: string;

  // Usuário do Kayser dono desse telefone (null = número de fora da equipe).
  @Column({ type: "varchar", nullable: true })
  userId: string | null;

  @Column({ type: "varchar", nullable: true })
  nome: string | null;

  // "in" = corretor → One; "out" = One → corretor.
  @Column({ type: "varchar", length: 3 })
  direction: "in" | "out";

  @Column({ type: "text" })
  content: string;

  @CreateDateColumn()
  createdAt: Date;
}
