import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from "typeorm";
import { User } from "../users/user.entity";

/**
 * Meta mensal de um usuário (corretor/gerente).
 * Uma meta por usuário/mês/ano.
 */
@Entity("goals")
@Unique(["userId", "month", "year"])
export class Goal {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ type: "int" })
  month: number; // 1-12

  @Column({ type: "int" })
  year: number;

  @Column({ type: "int", default: 0 })
  targetSales: number;

  @Column({ type: "int", default: 0 })
  targetVisits: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
