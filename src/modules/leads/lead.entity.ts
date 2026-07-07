import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../users/user.entity";

export enum LeadStatus {
  NOVO_LEAD = "novo_lead",
  PRIMEIRO_CONTATO = "primeiro_contato",
  EM_ATENDIMENTO = "em_atendimento",
  DOCUMENTACAO = "documentacao",
  AGENDAMENTO = "agendamento",
  VISITA_AGENDADA = "visita_agendada",
  VISITA_REALIZADA = "visita_realizada",
  SIMULACAO = "simulacao",
  SUBIDA_PASTA = "subida_pasta",
  APROVACAO = "aprovacao",
  REPROVACAO = "reprovacao",
  VENDA_GANHA = "venda_ganha",
  VENDA_PERDIDA = "venda_perdida",
}

@Entity("leads")
export class Lead {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column()
  phone: string;

  @Column({ nullable: true })
  whatsapp: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  empreendimento: string;

  // Vínculo com o imóvel cadastrado (empreendimento continua guardando o nome p/ exibição).
  @Column({ nullable: true })
  propertyId: string;

  @Column({ nullable: true })
  origem: string;

  @Column({ nullable: true })
  campanha: string;

  @Column({ nullable: true })
  cidade: string;

  @Column({ type: "decimal", nullable: true })
  renda: number;

  @Column({ type: "decimal", nullable: true })
  fgts: number;

  @Column({ type: "decimal", nullable: true })
  entrada: number;

  @Column({ type: "text", nullable: true })
  observacoes: string;

  // varchar (não enum do Postgres) para permitir editar/adicionar colunas do
  // Kanban sem precisar migrar o tipo do banco.
  @Column({ default: LeadStatus.NOVO_LEAD })
  status: string;

  @Column({ type: "int", nullable: true })
  score: number;

  @Column({ nullable: true })
  responsavelId: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "responsavelId" })
  responsavel: User;

  @Column({ nullable: true })
  lastContactAt: Date;

  @Column({ nullable: true })
  kanbanOrder: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
