import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/**
 * Check-in do corretor no plantão (GPS perto de um stand). Vale para UM turno da
 * escala num dia: sem check-in no turno ativo, a fila não manda lead pra ele.
 */
@Entity("plantao_checkins")
@Index(["userId", "turnoId", "data"], { unique: true })
export class PlantaoCheckin {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  userId: string;

  @Column()
  turnoId: string;

  // Dia (YYYY-MM-DD, horário de Brasília) do turno.
  @Column({ type: "varchar", length: 10 })
  data: string;

  // Imóvel cujo endereço de stand bateu (o stand fica no imóvel).
  @Column({ nullable: true })
  propertyId: string;

  @Column({ nullable: true })
  standNome: string;

  @Column({ type: "float" })
  lat: number;

  @Column({ type: "float" })
  lng: number;

  // Distância (m) até o stand na hora do check-in.
  @Column({ type: "int" })
  distancia: number;

  // Precisão (m) informada pelo celular. GPS falso costuma vir com 0–1 m.
  @Column({ type: "int", nullable: true })
  precisao: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
