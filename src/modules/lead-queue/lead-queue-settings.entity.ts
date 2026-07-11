import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

@Entity("lead_queue_settings")
export class LeadQueueSettings {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ default: false })
  enabled: boolean;

  @Column({ type: "int", default: 5 })
  slaMinutes: number;

  // Ordem do rodízio (ids de usuários). simple-array = coluna text separada por vírgula.
  @Column({ type: "simple-array", nullable: true })
  memberIds: string[];

  @Column({ type: "int", default: 0 })
  pointer: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
