import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum AiProvider {
  ANTHROPIC = "anthropic",
  OPENAI = "openai",
  GEMINI = "gemini",
}

/**
 * Configurações globais da empresa (linha única).
 * O Diretor/Administrador define o provedor de IA, a chave e o comportamento das automações.
 */
@Entity("settings")
export class Settings {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "enum", enum: AiProvider, default: AiProvider.ANTHROPIC })
  aiProvider: AiProvider;

  @Column({ nullable: true })
  aiModel: string;

  // Chave de API do provedor selecionado (informada pela empresa).
  @Column({ nullable: true })
  aiApiKey: string;

  // Permite sobrescrever o prompt mestre padrão.
  @Column({ type: "text", nullable: true })
  masterPrompt: string;

  // Automação de follow-up.
  @Column({ default: true })
  followupEnabled: boolean;

  @Column({ type: "int", default: 3 })
  followupDays: number;

  // Origens de lead que recebem o follow-up (simple-array: texto separado por vírgula).
  // Padrão: anúncio + cadastro manual (exclui WhatsApp orgânico).
  @Column({ type: "simple-array", default: "anuncio,manual" })
  followupSources: string[];

  // Textos da saudação por horário (usam {nome} = primeiro nome do lead).
  // Vazio → o AutomationService aplica o texto padrão.
  @Column({ type: "text", nullable: true })
  followupMsgManha: string;

  @Column({ type: "text", nullable: true })
  followupMsgTarde: string;

  @Column({ type: "text", nullable: true })
  followupMsgNoite: string;

  // Resposta automática da IA a novas mensagens de WhatsApp.
  @Column({ default: true })
  aiAutoReply: boolean;

  // Permite que a IA responda também a mensagens de GRUPOS do WhatsApp.
  // Desligado por padrão para evitar respostas em massa em grupos.
  @Column({ default: false })
  aiReplyGroups: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
