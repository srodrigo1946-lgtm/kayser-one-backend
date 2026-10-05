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

  // Chave da OpenAI só pra TRANSCREVER ÁUDIO dos clientes (Whisper) — a Claude não ouve.
  @Column({ nullable: true })
  audioApiKey: string;

  // IA One (assistente da equipe, número próprio) — chaves SEPARADAS das do atendimento.
  @Column({ type: "text", nullable: true })
  ioneClaudeKey: string | null;

  @Column({ type: "text", nullable: true })
  ioneOpenaiKey: string | null;

  // Planilha do Simulador Pro Soluto (Google Sheets, compartilhada por link).
  @Column({ type: "text", nullable: true })
  ionePlanilhaUrl: string | null;

  // Planilha da tabela de unidades (se houver) — senão usa o CSV enviado.
  @Column({ type: "text", nullable: true })
  ioneUnidadesUrl: string | null;

  @Column({ type: "text", nullable: true })
  ioneUnidadesCsv: string | null;

  // Link do painel de preços (Data Studio) que a One manda pro corretor.
  @Column({ type: "text", nullable: true })
  ionePrecosUrl: string | null;

  // Materiais (links de book/vídeo) e informações extras escritas pelo Diretor.
  @Column({ type: "text", nullable: true })
  ioneInfo: string | null;

  @Column({ default: true })
  ioneAtivo: boolean;

  // Permite sobrescrever o prompt mestre padrão.
  @Column({ type: "text", nullable: true })
  masterPrompt: string;

  // Automação de follow-up.
  @Column({ default: true })
  followupEnabled: boolean;

  @Column({ type: "int", default: 3 })
  followupDays: number;

  // Origens de lead que recebem o follow-up (simple-array: texto separado por vírgula).
  // Padrão: anúncio + WhatsApp do número central + cadastro manual (igual ao bootstrap).
  @Column({ type: "simple-array", default: "anuncio,whatsapp,manual" })
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

  // Contingência: WhatsApp central parado/bloqueado. Nada sai pelo WhatsApp (nem IA,
  // nem follow-up); os leads continuam entrando e indo pra fila. Desligou = volta ao normal.
  @Column({ default: false })
  whatsappPausado: boolean;

  // Conta(s) de anúncio do Meta (IDs, vírgula) de onde vem o gasto do Custo por Lead.
  @Column({ type: "text", nullable: true })
  metaAdAccountIds: string;

  // Imagem das condições comerciais do mês (aba Grupo Direcional). Chave no R2
  // ou data URI (fallback). Só o Diretor troca; todos os cargos veem.
  @Column({ type: "text", nullable: true })
  direcionalImage: string;

  // Diretor libera a aba "Custo por Lead" para todos os cargos verem (padrão: só ele).
  @Column({ default: false })
  custoLeadVisivel: boolean;

  // Origens extras de lead (times/captação) que o Diretor cadastra pela UI. Aparecem
  // no seletor "Origem do lead" para todos os cargos. Não contam no Custo por Lead
  // (entram como source "manual"). simple-array = texto separado por vírgula.
  @Column({ type: "simple-array", default: "Time Tati,Time Helen,Time Allan,Time Marisa,Time Isabelle,Time Isaac,Time Andre,Time Edjane,Corujão" })
  leadOrigens: string[];

  // ===== Corujão (repique de leads sem interesse) =====
  // Liga o repique automático diário.
  @Column({ default: false })
  corujaoEnabled: boolean;

  // Horário do repique automático (Brasília), "HH:MM". Diretor edita.
  @Column({ default: "14:00" })
  corujaoHora: string;

  // Chave da coluna do Kanban usada como fonte (vazio = resolve por título "sem interesse").
  @Column({ type: "text", nullable: true })
  corujaoStatus: string;

  // Inclui no repique os leads que estão com o Diretor.
  @Column({ default: true })
  corujaoIncluirDiretor: boolean;

  // Check-in por GPS no stand obrigatório pra receber lead do plantão.
  @Column({ default: true })
  checkinObrigatorio: boolean;

  // Plantão livre (todos os corretores, sem escala) a partir deste dia (YYYY-MM-DD). Vazio = por escala.
  @Column({ type: "text", nullable: true })
  plantaoLivreDesde: string | null;

  // Máximo de leads do Corujão que cada corretor pega por dia (0 = sem limite).
  @Column({ type: "int", default: 20 })
  corujaoLimiteDia: number;

  // Último dia (YYYY-MM-DD, Brasília) em que o repique automático rodou (anti-duplicidade).
  @Column({ type: "text", nullable: true })
  corujaoLastRun: string;

  // Quantos leads liberar automaticamente por dia no horário (0 = só manual).
  @Column({ type: "int", default: 0 })
  corujaoAutoQtd: number;

  // Agendamento ÚNICO: data+hora pra liberar o Corujão automaticamente uma vez.
  // Ao disparar, o cron limpa este campo. Null = sem agendamento.
  @Column({ type: "timestamp", nullable: true })
  corujaoAgendadoPara: Date | null;

  // Links dos relatórios Looker da aba Grupo Direcional (o Diretor edita pela UI).
  @Column({ type: "text", nullable: true })
  direcionalUrl: string;

  @Column({ type: "text", nullable: true })
  tabelaRivaUrl: string;

  // Integração Meta (formulário de anúncio). O Diretor cola aqui em vez de env.
  @Column({ type: "text", nullable: true })
  metaPageToken: string;

  @Column({ type: "text", nullable: true })
  metaVerifyToken: string;

  // IDs dos formulários do Meta que mandam lead pro Kayser (vírgula). Vazio = todos.
  @Column({ type: "text", nullable: true })
  metaFormIds: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
