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
