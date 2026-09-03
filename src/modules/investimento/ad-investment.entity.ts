import { Entity, PrimaryGeneratedColumn, Column, Unique } from "typeorm";

/** Investimento em anúncio por mês (o Diretor digita; no futuro pode vir do Meta). */
@Entity("ad_investments")
@Unique(["ano", "mes"])
export class AdInvestment {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "int" })
  ano: number;

  @Column({ type: "int" })
  mes: number; // 1-12

  @Column({ type: "numeric", default: 0 })
  valor: number;

  // De onde veio o valor: "manual" (Diretor digitou) ou "facebook" (futuro, via API).
  @Column({ type: "varchar", default: "manual" })
  fonte: string;
}
