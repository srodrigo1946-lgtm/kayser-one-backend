import { Injectable, Logger } from "@nestjs/common";
import { ConversationsService } from "../conversations/conversations.service";
import { SettingsService } from "../settings/settings.service";
import { AiService } from "../ai/ai.service";
import { WhatsappService } from "./whatsapp.service";
import { LeadQueueService } from "../lead-queue/lead-queue.service";
import { UsersService } from "../users/users.service";
import { UserRole } from "../users/user.entity";

@Injectable()
export class WhatsappFlowService {
  private readonly logger = new Logger(WhatsappFlowService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly settings: SettingsService,
    private readonly ai: AiService,
    private readonly whatsapp: WhatsappService,
    private readonly leadQueue: LeadQueueService,
    private readonly users: UsersService
  ) {}

  /**
   * Processa um evento de mensagem recebida da Evolution API.
   * Persiste a mensagem e, se a resposta automática estiver ligada, gera e envia a resposta da IA.
   */
  async handleInbound(payload: any) {
    try {
      const parsed = this.parseEvolutionMessage(payload);
      if (!parsed) return { ignored: true };

      const { remoteJid, remoteJidFull, isGroup, text, mediaType, fromMe, pushName, instanceName, ad } = parsed;
      if (fromMe || !text) return { ignored: true };

      // A instância se chama "user_<id>": é o dono do número que recebeu a mensagem.
      const receivingUserId = instanceName?.startsWith("user_")
        ? instanceName.slice("user_".length)
        : undefined;
      const conv = await this.conversations.findOrCreateByPhone(remoteJid, receivingUserId, isGroup);

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

      // REGRA: só o NÚMERO CENTRAL (Diretor) gera lead/rodízio automático. No
      // WhatsApp de um cargo, quem chega é cliente dele, contato pessoal ou grupo
      // — nada disso pode virar lead aleatório nem entrar na fila. Grupo nunca.
      let recebeuNoCentral = false;
      if (ad && !isGroup && receivingUserId) {
        const dono = await this.users.findOne(receivingUserId).catch(() => null);
        recebeuNoCentral = dono?.role === UserRole.DIRETOR;
        if (!recebeuNoCentral) {
          this.logger.log(
            `Anúncio ignorado para a fila: chegou no número de um cargo (${receivingUserId}), não no central.`
          );
        }
      }

      // Anúncio "Clique para WhatsApp" NO NÚMERO CENTRAL: marca origem/campanha e,
      // se a fila estiver ligada, distribui em rodízio entre os cargos.
      if (ad && !isGroup && recebeuNoCentral) {
        // Log para diagnóstico: sem isto, um anúncio que chega num formato
        // inesperado não distribui e não deixa rastro nenhum.
        this.logger.log(
          `Lead de ANÚNCIO detectado (${ad.platform}${ad.campaign ? ` / ${ad.campaign}` : ""}) de ${remoteJid}.`
        );
        // Garante o Lead (cria se não existir) → cai no Kanban como Novo Lead.
        const adLeadId = await this.conversations.setAdOrigin(conv.id, ad.platform, ad.campaign, conv.leadId);
        conv.leadId = adLeadId ?? conv.leadId;
        conv.fromAd = true;
        const queue = await this.leadQueue.getSettings();
        if (queue.enabled) {
          await this.leadQueue.enqueueAdLead({ conversationId: conv.id, leadId: conv.leadId ?? undefined });
        }
      }

      // Mídia (imagem/áudio/etc.) é registrada, mas a IA não responde a ela (não "vê" o conteúdo).
      if (mediaType) return { persisted: true, autoReply: false, media: mediaType };

      const settings = await this.settings.get();
      if (!settings.aiAutoReply) return { persisted: true, autoReply: false };

      // Mensagens de grupo só recebem resposta da IA se o toggle estiver ligado.
      if (isGroup && !settings.aiReplyGroups) {
        return { persisted: true, autoReply: false, group: true };
      }

      // Gera resposta da IA com base no histórico, usando a IA do cargo que atende
      // a conversa (ou a chave da empresa, se ele não tiver a própria).
      const history = await this.conversations.getHistoryForAi(conv.id);
      const userAi = await this.ai.getUserAiConfig(conv.assignedToId ?? undefined);
      let reply: string;
      try {
        reply = await this.ai.generateReply(history, userAi);
      } catch (err) {
        this.logger.warn(`IA não respondeu (chave/config?): ${(err as Error).message}`);
        return { persisted: true, autoReply: false };
      }

      if (reply) {
        await this.conversations.addMessage(conv.id, reply, "out", true);

        // Score do lead: a IA qualifica sozinha a partir da conversa. Roda em
        // segundo plano (não segura a resposta ao cliente) e falha em silêncio —
        // sem score é melhor que sem resposta.
        if (conv.leadId) {
          const texto = history.map((m) => `${m.role}: ${m.content}`).join("\n");
          this.ai
            .qualifyLead(conv.leadId, texto, userAi)
            .catch((err) => this.logger.warn(`Não foi possível qualificar o lead: ${err?.message}`));
        }
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

  /**
   * Envio manual (cargo) que também registra na conversa. Responde SEMPRE pelo número
   * dono da conversa (`instanceOwnerId`) — importante quando é um lead da fila no número
   * central. Se for lead de anúncio, a resposta do cargo atribuído marca como atendido.
   */
  async sendManual(senderUserId: string, remoteJid: string, text: string) {
    const conv = await this.conversations.findOrCreateByPhone(remoteJid, senderUserId);
    const instanceOwner = conv.instanceOwnerId || senderUserId;
    await this.conversations.addMessage(conv.id, text, "out", false);
    if (conv.fromAd) {
      await this.leadQueue.markAttended(conv.id, senderUserId).catch(() => {});
    }
    return this.whatsapp.sendText(`user_${instanceOwner}`, remoteJid, text);
  }

  /**
   * Envio manual de ARQUIVO (imagem, PDF, Excel...) pelo cargo: registra na conversa
   * (a mídia vai pro R2/banco via addMessage) e envia pelo número dono da conversa.
   */
  async sendManualMedia(
    senderUserId: string,
    remoteJid: string,
    file: { base64: string; mimetype: string; fileName: string; caption?: string }
  ) {
    const conv = await this.conversations.findOrCreateByPhone(remoteJid, senderUserId);
    const instanceOwner = conv.instanceOwnerId || senderUserId;
    const ehImagem = file.mimetype.startsWith("image/");
    const rotulo = file.caption?.trim() || (ehImagem ? "📷 Imagem" : `📎 ${file.fileName}`);

    await this.conversations.addMessage(conv.id, rotulo, "out", false, {
      mediaType: ehImagem ? "image" : "document",
      mediaMime: file.mimetype,
      base64: file.base64,
    });
    if (conv.fromAd) {
      await this.leadQueue.markAttended(conv.id, senderUserId).catch(() => {});
    }
    return this.whatsapp.sendMedia(`user_${instanceOwner}`, remoteJid, file);
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
    ad?: { platform: "facebook" | "instagram" | "tiktok"; campaign?: string };
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

    // Anúncio "Clique para WhatsApp": o Meta manda o referral no contextInfo.externalAdReply.
    // O contextInfo pode vir dentro do extendedTextMessage, na própria message, ou no msg.
    const ctx =
      message.extendedTextMessage?.contextInfo ||
      (message as any).contextInfo ||
      (msg as any).contextInfo;
    // ATENÇÃO: em mensagem de anúncio o `externalAdReply` costuma vir VAZIO ({}).
    // O sinal confiável é `entryPointConversionSource: "ctwa_ad"` (click-to-WhatsApp),
    // com a plataforma em `entryPointConversionApp`. Olhar só o externalAdReply fazia
    // a fila nunca disparar em anúncio real.
    const ext = ctx?.externalAdReply;
    const conversionSource = String(ctx?.entryPointConversionSource || "").toLowerCase();
    const veioDeAnuncio = !!ext || conversionSource.includes("ctwa") || conversionSource.includes("ad");
    let ad: { platform: "facebook" | "instagram" | "tiktok"; campaign?: string } | undefined;
    if (veioDeAnuncio) {
      const app = String(
        ctx?.entryPointConversionApp || ext?.sourceApp || ext?.sourceType || ""
      ).toLowerCase();
      const platform = app.includes("insta") ? "instagram" : app.includes("tiktok") ? "tiktok" : "facebook";
      ad = { platform, campaign: ext?.title || ext?.sourceId || ctx?.ctwaPayload || undefined };
    } else {
      // Diagnóstico (temporário): mensagem NÃO reconhecida como anúncio.
      // Loga só as CHAVES (nunca o conteúdo) pra identificar o formato que o Meta
      // manda de verdade. Nível `log` de propósito: em produção `debug` não sai.
      // Sem contextInfo também loga — senão ficamos cegos justamente no caso ruim.
      this.logger.log(
        `Inbound sem anúncio. message=[${Object.keys(message).join(",")}] contextInfo=[${
          ctx ? Object.keys(ctx).join(",") : "AUSENTE"
        }]`
      );
    }

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
      ad,
    };
  }
}
