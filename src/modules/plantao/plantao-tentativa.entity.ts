import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/**
 * Tentativa de check-in que deu errado (longe do stand, fora do prazo, GPS negado…).
 * Serve pro Diretor ver na hora por que o corretor não entrou no plantão.
 */
@Entity("plantao_tentativas")
@Index(["data"])
export class PlantaoTentativa {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userId: string;

  // Dia (YYYY-MM-DD, Brasília).
  @Column({ type: "varchar", length: 10 })
  data: string;

  @Column({ type: "text" })
  motivo: string;

  // Distância (m) até o stand mais perto, quando o GPS respondeu.
  @Column({ type: "int", nullable: true })
  distancia: number | null;

  @Column({ type: "varchar", nullable: true })
  standNome: string | null;

  @Column({ type: "int", nullable: true })
  precisao: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
