import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from "typeorm";

export enum UserRole {
  DIRETOR = "diretor",
  SUPERINTENDENTE = "superintendente",
  GERENTE_GERAL = "gerente_geral",
  GERENTE = "gerente",
  CORRETOR = "corretor",
}

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: "enum", enum: UserRole, default: UserRole.CORRETOR })
  role: UserRole;

  // Foto de perfil (data URI base64 ou URL). text para comportar imagens embutidas.
  @Column({ type: "text", nullable: true })
  avatar: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  whatsapp: string;

  @Column({ default: true })
  active: boolean;

  @Column({ default: true })
  firstLogin: boolean;

  @Column({ nullable: true })
  managerId: string;

  @ManyToOne(() => User, (u) => u.subordinates, { nullable: true })
  @JoinColumn({ name: "managerId" })
  manager: User;

  @OneToMany(() => User, (u) => u.manager)
  subordinates: User[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
