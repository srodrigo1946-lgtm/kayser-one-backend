import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/**
 * Imobiliária que comprou o Kayser One (venda SaaS). Só existe na instalação da Kayser:
 * cada linha é uma instalação própria do cliente (serviço no Railway + banco próprio),
 * acessada por `subdominio`.kayserone.com.br.
 */
@Entity("clientes_saas")
export class ClienteSaas {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  empresa: string;

  @Column({ unique: true })
  subdominio: string;

  @Column()
  plano: string;

  @Column({ type: "int" })
  limiteUsuarios: number;

  // Serviços adicionais ligados, separados por vírgula: ia, ione, meta.
  @Column({ default: "" })
  adicionais: string;

  // Valor mensal negociado pelo Diretor da Kayser (R$). Vazio = preço de tabela (plano + adicionais).
  @Column({ type: "numeric", nullable: true, transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) } })
  valorMensal: number | null;

  // Cobrança no Mercado Pago (assinatura mensal): id, link de pagamento e situação
  // (pending = aguardando, authorized = em dia, paused = pausada, cancelled = cancelada).
  @Column({ type: "varchar", nullable: true })
  cobrancaId: string | null;

  @Column({ type: "varchar", nullable: true })
  cobrancaLink: string | null;

  @Column({ type: "varchar", nullable: true })
  assinatura: string | null;

  // "site" = o próprio cliente assinou pela página de vendas; vazio = criado pelo painel.
  @Column({ type: "varchar", nullable: true })
  origem: string | null;

  // Último pagamento avulso (Pix/cartão) aprovado — "mês pago".
  @Column({ type: "timestamp", nullable: true })
  pagoEm: Date | null;

  @Column()
  diretorNome: string;

  @Column()
  diretorEmail: string;

  // criando | ativo | erro
  @Column({ default: "criando" })
  status: string;

  // Passo atual (aparece na tela enquanto cria).
  @Column({ type: "varchar", nullable: true })
  etapa: string | null;

  @Column({ type: "varchar", nullable: true })
  railwayServiceId: string | null;

  // https://<dominio>.up.railway.app/api/v1
  @Column({ type: "varchar", nullable: true })
  apiUrl: string | null;

  @Column({ type: "text", nullable: true })
  erro: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
