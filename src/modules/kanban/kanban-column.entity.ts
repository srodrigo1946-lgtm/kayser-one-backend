import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

/**
 * Coluna do Kanban editável pelo Diretor. A `key` é o valor gravado em
 * `lead.status` (por isso o status virou varchar — permite colunas dinâmicas).
 */
@Entity("kanban_columns")
export class KanbanColumnEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true })
  key: string;

  @Column()
  title: string;

  @Column({ default: "📋" })
  emoji: string;

  @Column({ default: "#6366f1" })
  color: string;

  @Column({ type: "int", default: 0 })
  position: number;

  @CreateDateColumn()
  createdAt: Date;
}
