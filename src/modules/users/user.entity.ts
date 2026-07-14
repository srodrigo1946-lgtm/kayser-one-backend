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
  // OBS.: empresa parceira NÃO é um cargo novo (evita ALTER TYPE no enum do Postgres
  // e mantém Record<UserRole,...> completo). O login da empresa nasce como CORRETOR +
  // users.empresaId; a detecção "é empresa" é feita por empresaId.
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

  // Quando o usuário é uma EMPRESA parceira, aponta para a empresa (partner_companies).
  @Column({ type: "uuid", nullable: true })
  empresaId: string;

  // Foto de perfil (data URI base64 ou URL). text para comportar imagens embutidas.
  @Column({ type: "text", nullable: true })
  avatar: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ nullable: true })
  whatsapp: string;

  @Column({ default: true })
  active: boolean;

  // IA própria do usuário (cada cargo pode usar seu provedor/chave). Quando não
  // configurada, o sistema cai na chave da empresa (Settings) e depois no env.
  // aiApiKey NUNCA é retornada ao front — só o booleano hasAiKey (ver sanitizador).
  @Column({ nullable: true })
  aiProvider: string;

  @Column({ nullable: true })
  aiModel: string;

  @Column({ type: "text", nullable: true })
  aiApiKey: string;

  @Column({ default: true })
  firstLogin: boolean;

  // Código de recuperação do Diretor (bcrypt). NUNCA retornado ao front (só hasRecoveryCode).
  // Permite ao Diretor (topo da hierarquia) recuperar a senha sem depender de e-mail/gestor.
  @Column({ type: "text", nullable: true })
  recoveryCodeHash: string;

  // Aprovação do gestor para autocadastros. Usuários criados pelo painel já nascem
  // aprovados; quem se autocadastra fica pendente até o gestor aprovar.
  @Column({ default: true })
  approved: boolean;

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
