import { Entity, PrimaryGeneratedColumn, Column, Unique } from "typeorm";

/**
 * Gasto em anúncio por DIA (Diretor digita manualmente, ou uma ferramenta
 * parceira empurra via /investimento/dia-direct). Quando há linhas de dia num
 * mês, elas mandam no total do mês (soma) e no gráfico diário.
 */
@Entity("ad_investment_days")
@Unique(["ano", "mes", "dia"])
export class AdInvestmentDay {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "int" })
  ano: number;

  @Column({ type: "int" })
  mes: number; // 1-12

  @Column({ type: "int" })
  dia: number; // 1-31

  @Column({ type: "numeric", default: 0 })
  valor: number;

  // "manual" (Diretor digitou) ou "facebook" (empurrado pela integração).
  @Column({ type: "varchar", default: "manual" })
  fonte: string;
}
