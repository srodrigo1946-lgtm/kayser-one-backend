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

  // Desde quando o WhatsApp central está fora (caiu/suspenso). Ao voltar, os leads de
  // anúncio/formulário/WhatsApp que entraram nesse tempo e ninguém atendeu voltam pra fila (Rodrigo 07/11).
  @Column({ type: "timestamp", nullable: true })
  whatsappCaiuEm: Date | null;

  // Fila SWAT (Rodrigo 11/11): até 16 corretores que recebem os leads mais qualificados
  // (formulário Meta "SWAT" + qualificados pela IA). Mesmo check-in/turno da fila normal.
  @Column({ type: "simple-array", nullable: true })
  swatMemberIds: string[];

  @Column({ type: "int", default: 0 })
  swatPointer: number;

  // Quem é o PRÓXIMO (pessoa, não posição): a lista muda quando alguém faz check-in ou
  // sai, e a posição apontava pra outra pessoa sem lead entregue (Rodrigo 21/11).
  @Column({ type: "varchar", nullable: true })
  proximoId: string | null;

  @Column({ type: "varchar", nullable: true })
  swatProximoId: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
