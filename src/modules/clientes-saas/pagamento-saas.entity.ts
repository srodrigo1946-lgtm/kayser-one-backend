import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

const numero = { to: (v: number | null) => v, from: (v: string | null) => (v == null ? null : Number(v)) };

/**
 * Dinheiro que ENTROU (caixa do Business K1): cada pagamento aprovado no Mercado Pago,
 * Pix/avulso ou parcela da assinatura no cartão. Gravado pelo aviso do Mercado Pago.
 */
@Entity("pagamentos_saas")
export class PagamentoSaas {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Id do pagamento no Mercado Pago (não grava duas vezes o mesmo aviso).
  @Index({ unique: true })
  @Column()
  mpId: string;

  @Column({ type: "uuid", nullable: true })
  clienteId: string | null;

  // Valor cobrado e o que caiu na conta (já sem a taxa do Mercado Pago).
  @Column({ type: "numeric", transformer: numero })
  valor: number;

  @Column({ type: "numeric", transformer: numero })
  liquido: number;

  // pix, cartão, saldo...
  @Column({ type: "varchar", nullable: true })
  meio: string | null;

  @Column({ type: "timestamp" })
  pagoEm: Date;

  @CreateDateColumn()
  createdAt: Date;
}
