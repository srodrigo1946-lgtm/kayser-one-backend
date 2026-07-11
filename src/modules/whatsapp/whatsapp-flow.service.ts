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

      const { remoteJid, remoteJidFull, isGroup, text, mediaType, fromMe, pushName, instanceName } = parsed;
      if (fromMe || !text) return { ignored: true };

      // A instância se chama "user_<id>": é o dono do número que recebeu a mensagem.
      const receivingUserId = instanceName?.startsWith("user_")
        ? instanceName.slice("user_".length)
        : undefined;
      const conv = await this.conversations.findOrCreateByPhone(remoteJid, receivingUserId);

      // Baixa a mídia (imagem/áudio/vídeo/documento) para exibir no chat.
      let media: { mediaType: string; mediaMime: string; base64: string } | undefined;
      if (mediaType && mediaType !== "location" && mediaType !== "contact" && instanceName) {
        const rawMsg = Array.isArray(payload?.data) ? payload.data[0] : payload?.data ?? payload;
        const dl = await this.whatsapp.getMediaBase64(instanceName, rawMsg);
        if (dl) media = { mediaType, mediaMime: dl.mimetype, base64: dl.base64 };
      }
      await this.conversations.addMessage(conv.id, text, "in", false, media);

      // Nome + foto do contato/grupo (busca a foto só quando ainda não temos).
      if (!isGroup) {
        // Individual: pushName é o nome do contato.
        let avatar = conv.contactAvatar;
        if (!avatar && instanceName) {
          avatar = await this.whatsapp.fetchProfilePicture(instanceName, remoteJid);
        }
        await this.conversations.setContactInfo(conv.id, pushName, avatar);
      } else if (instanceName && (!conv.contactName || !conv.contactAvatar)) {
        // Grupo: usa o nome (subject) e a foto do grupo.
        const info = await this.whatsapp.fetchGroupInfo(instanceName, remoteJidFull);
        await this.conversations.setContactInfo(conv.id, info.name, info.avatar);
      }

      // Mídia (imagem/áudio/etc.) é registrada, mas a IA não responde a ela (não "vê" o conteúdo).
      if (mediaType) return { persisted: true, autoReply: false, media: mediaType };

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
    mediaType: string | null;
    fromMe: boolean;
    pushName: string;
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
    let text = message.conversation || message.extendedTextMessage?.text || "";
    let mediaType: string | null = null;

    // Mídia: quando não há texto, mostra um marcador para o atendente saber o que chegou.
    if (!text) {
      if (message.imageMessage) {
        mediaType = "image";
        text = message.imageMessage.caption || "📷 Imagem";
      } else if (message.audioMessage) {
        mediaType = "audio";
        text = message.audioMessage.ptt ? "🎤 Áudio (mensagem de voz)" : "🎵 Áudio";
      } else if (message.videoMessage) {
        mediaType = "video";
        text = message.videoMessage.caption || "🎥 Vídeo";
      } else if (message.documentMessage) {
        mediaType = "document";
        text = `📎 ${message.documentMessage.fileName || "Documento"}`;
      } else if (message.stickerMessage) {
        mediaType = "sticker";
        text = "🩹 Figurinha";
      } else if (message.locationMessage) {
        mediaType = "location";
        text = "📍 Localização";
      } else if (message.contactMessage || message.contactsArrayMessage) {
        mediaType = "contact";
        text = "👤 Contato compartilhado";
      }
    }

    return {
      remoteJid: remoteJidRaw.split("@")[0],
      remoteJidFull: remoteJidRaw,
      isGroup: remoteJidRaw.includes("@g.us"),
      text,
      mediaType,
      fromMe: !!key.fromMe,
      pushName: msg.pushName || "",
      instanceName,
    };
  }
}
