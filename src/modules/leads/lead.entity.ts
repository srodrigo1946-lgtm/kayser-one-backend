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

// Origem de criação do lead — usada para escopar automações (ex.: follow-up).
export enum LeadSource {
  ANUNCIO = "anuncio", // veio de anúncio "Clique para WhatsApp" (Face/Insta/TikTok)
  MANUAL = "manual", // cadastrado por um cargo no formulário de Leads
  WHATSAPP = "whatsapp", // chegou sozinho no WhatsApp (sem anúncio)
}

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

  // Como o lead entrou no sistema (escopa o follow-up automático).
  // varchar (não enum do Postgres) para facilitar novos valores sem migrar tipo.
  @Column({ default: LeadSource.MANUAL })
  source: string;

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

  // Valor da venda fechada (preenchido ao marcar "Venda Ganha"). Base do VGV.
  @Column({ type: "decimal", nullable: true })
  valorVenda: number;

  // Cadastro completo (financiamento / "Subir Pasta para Análise"). Endereço tem
  // o `cidade` reaproveitado acima.
  @Column({ nullable: true })
  cpf: string;

  @Column({ type: "date", nullable: true })
  dataNascimento: string;

  @Column({ nullable: true })
  estadoCivil: string;

  @Column({ nullable: true })
  cep: string;

  @Column({ nullable: true })
  logradouro: string;

  @Column({ nullable: true })
  numero: string;

  @Column({ nullable: true })
  complemento: string;

  @Column({ nullable: true })
  bairro: string;

  @Column({ nullable: true })
  estado: string;

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
