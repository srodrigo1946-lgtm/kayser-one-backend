import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from "typeorm";
import { Document } from "./document.entity";

@Entity("document_requests")
export class DocumentRequest {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Token do link público de upload.
  @Column({ unique: true })
  token: string;

  @Column({ nullable: true })
  leadId: string;

  @Column({ nullable: true })
  conversationId: string;

  // Dados do cliente (usados no nome dos arquivos).
  @Column()
  clientName: string;

  @Column({ nullable: true })
  clientPhone: string;

  // simplificada | completa
  @Column({ default: "simplificada" })
  fase: string;

  // clt | autonomo
  @Column({ default: "clt" })
  perfil: string;

  // solteiro | casado
  @Column({ default: "solteiro" })
  estadoCivil: string;

  // Declara imposto de renda? (exige IR completo na fase completa)
  @Column({ default: false })
  declaraIR: boolean;

  @Column({ nullable: true })
  createdById: string;

  @OneToMany(() => Document, (d) => d.request)
  documents: Document[];

  @CreateDateColumn()
  createdAt: Date;
}
