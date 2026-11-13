import { Entity, PrimaryGeneratedColumn, Column, Unique } from "typeorm";

/**
 * Resultado de cada ANÚNCIO por dia (Tathy, 13/11). Meta: puxado de hora em hora pela
 * Marketing API. Google Ads: o script colado no Google Ads empurra pro /investimento/google-direct.
 */
@Entity("anuncio_dias")
@Unique("uq_anuncio_dia", ["canal", "data", "anuncio"])
export class AnuncioDia {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "varchar" })
  canal: string; // "meta" | "google"

  @Column({ type: "date" })
  data: string;

  @Column({ type: "varchar", length: 300 })
  anuncio: string;

  @Column({ type: "varchar", length: 300, nullable: true })
  campanha: string | null;

  @Column({ type: "numeric", default: 0 })
  gasto: number;

  @Column({ type: "int", default: 0 })
  cliques: number;

  @Column({ type: "int", default: 0 })
  impressoes: number;

  @Column({ type: "numeric", default: 0 })
  conversoes: number;
}
