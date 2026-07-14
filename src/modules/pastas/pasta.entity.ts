import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/** Pasta de análise (financiamento) — "Subir Pasta para Análise". */
@Entity("analysis_folders")
export class Pasta {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Cliente (Lead). clientName/clientCpf denormalizados p/ exibir na lista sem join.
  @Column({ type: "uuid" })
  leadId: string;
  @Column()
  clientName: string;
  @Column({ nullable: true })
  clientCpf: string;

  // Empreendimento (Property) + campos por negócio.
  @Column({ type: "uuid", nullable: true })
  propertyId: string;
  @Column({ nullable: true })
  empreendimento: string;
  @Column({ nullable: true })
  construtora: string;
  @Column({ nullable: true })
  unidade: string;
  @Column({ nullable: true })
  bloco: string;
  @Column({ nullable: true })
  apartamento: string;
  @Column({ type: "numeric", nullable: true })
  valorAvaliacao: number;
  @Column({ type: "numeric", nullable: true })
  valorVendaFinal: number;
  @Column({ type: "text", nullable: true })
  condicoesComerciais: string;
  @Column({ type: "text", nullable: true })
  observacoes: string;

  // Análise: fase (simplificada|completa) e perfil (clt|empresario).
  @Column({ default: "simplificada" })
  fase: string;
  @Column({ default: "clt" })
  perfil: string;

  // Liga aos documentos (Fase 3b) e à empresa parceira / parecer (Fases 1 e 4).
  @Column({ type: "uuid", nullable: true })
  documentRequestId: string;
  @Column({ type: "uuid", nullable: true })
  empresaId: string;
  @Column({ type: "text", nullable: true })
  parecer: string;

  // montando | em_analise | aprovado | reprovado | complemento
  @Column({ default: "montando" })
  status: string;

  // Escopo por hierarquia: responsavelId = corretor dono (copiado do lead).
  @Column({ type: "uuid", nullable: true })
  responsavelId: string;
  @Column({ type: "uuid", nullable: true })
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;
  @UpdateDateColumn()
  updatedAt: Date;
}
