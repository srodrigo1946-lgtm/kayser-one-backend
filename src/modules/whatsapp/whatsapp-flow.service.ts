import { Injectable, Logger } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { SettingsService } from "../settings/settings.service";
import { AiService } from "../ai/ai.service";
import { WhatsappService } from "./whatsapp.service";

@Injectable()
export class WhatsappFlowService {
  private readonly logger = new Logger(WhatsappFlowService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly settings: SettingsService,
    private readonly ai: AiService,
    private readonly whatsapp: WhatsappService
  ) {}

  /**
   * Processa um evento de mensagem recebida da Evolution API.
   * Persiste a mensagem e, se a resposta automática estiver ligada, gera e envia a resposta da IA.
   */
  async handleInbound(payload: any) {
    try {
      const parsed = this.parseEvolutionMessage(payload);
      if (!parsed) return { ignored: true };

      const { remoteJid, remoteJidFull, isGroup, text, fromMe, instanceName } = parsed;
      if (fromMe || !text) return { ignored: true };

      const conv = await this.conversations.findOrCreateByPhone(remoteJid);
      await this.conversations.addMessage(conv.id, text, "in");

      const settings = await this.settings.get();
      if (!settings.aiAutoReply) return { persisted: true, autoReply: false };

      // Mensagens de grupo só recebem resposta da IA se o toggle estiver ligado.
      if (isGroup && !settings.aiReplyGroups) {
        return { persisted: true, autoReply: false, group: true };
      }

      // Gera resposta da IA com base no histórico
      const history = await this.conversations.getHistoryForAi(conv.id);
      let reply: string;
      try {
        reply = await this.ai.generateReply(history);
      } catch (err) {
        this.logger.warn(`IA não respondeu (chave/config?): ${(err as Error).message}`);
        return { persisted: true, autoReply: false };
      }

      if (reply) {
        await this.conversations.addMessage(conv.id, reply, "out", true);
        if (instanceName) {
          try {
            await this.whatsapp.sendText(instanceName, remoteJidFull, reply);
          } catch (err) {
            this.logger.warn(`Falha ao enviar via WhatsApp: ${(err as Error).message}`);
          }
        }
      }
      return { persisted: true, autoReply: true };
    } catch (err) {
      this.logger.error("Erro no fluxo de entrada do WhatsApp", err as any);
      return { error: true };
    }
  }

  /** Envio manual (corretor) que também registra na conversa. */
  async sendManual(instanceName: string, remoteJid: string, text: string) {
    const conv = await this.conversations.findOrCreateByPhone(remoteJid);
    await this.conversations.addMessage(conv.id, text, "out", false);
    return this.whatsapp.sendText(instanceName, remoteJid, text);
  }

  /** Extrai os campos relevantes do payload da Evolution API (evento messages.upsert). */
  private parseEvolutionMessage(payload: any): {
    remoteJid: string;
    remoteJidFull: string;
    isGroup: boolean;
    text: string;
    fromMe: boolean;
    instanceName?: string;
  } | null {
    const data = payload?.data ?? payload;
    const instanceName = payload?.instance || payload?.instanceName;
    const msg = Array.isArray(data) ? data[0] : data;
    if (!msg) return null;

    const key = msg.key ?? {};
    const remoteJidRaw: string = key.remoteJid || msg.remoteJid || "";
    if (!remoteJidRaw) return null;

    const message = msg.message ?? {};
    const text =
      message.conversation ||
      message.extendedTextMessage?.text ||
      message.imageMessage?.caption ||
      "";

    return {
      remoteJid: remoteJidRaw.split("@")[0],
      remoteJidFull: remoteJidRaw,
      isGroup: remoteJidRaw.includes("@g.us"),
      text,
      fromMe: !!key.fromMe,
      instanceName,
    };
  }
}
