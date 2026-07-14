import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/** Empresa parceira (correspondente bancário) que analisa as pastas. */
@Entity("partner_companies")
export class Empresa {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  cnpj: string;

  @Column()
  email: string;

  @Column({ nullable: true })
  nome: string;

  // pendente | aprovada | reprovada — liberação é do Diretor.
  @Column({ default: "pendente" })
  status: string;

  @Column({ type: "uuid", nullable: true })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;
  @UpdateDateColumn()
  updatedAt: Date;
}
