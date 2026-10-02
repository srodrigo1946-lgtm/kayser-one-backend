import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/**
 * Corretor bloqueado no plantão (não faz check-in nem recebe lead da fila) até
 * alguém da hierarquia desbloquear. Diretor bloqueia todos; gestor, a própria equipe.
 */
@Entity("plantao_bloqueios")
export class PlantaoBloqueio {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column()
  userId: string;

  @Column()
  porId: string;

  @Column()
  porNome: string;

  // Bloqueio do Diretor: só o Diretor desbloqueia.
  @Column({ default: false })
  porDiretor: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
