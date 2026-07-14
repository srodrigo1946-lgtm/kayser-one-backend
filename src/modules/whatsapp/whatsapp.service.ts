import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly webhookUrl: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get("EVOLUTION_API_URL", "http://localhost:8080");
    this.apiKey = config.get("EVOLUTION_API_KEY", "");
    // URL pública deste backend, para onde a Evolution deve mandar os eventos.
    // Usa WEBHOOK_PUBLIC_URL se definido; senão o domínio público do Railway.
    const base =
      config.get<string>("WEBHOOK_PUBLIC_URL") ||
      (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
    const token = config.get<string>("WHATSAPP_WEBHOOK_TOKEN");
    this.webhookUrl = base
      ? `${base.replace(/\/$/, "")}/api/v1/whatsapp/webhook${token ? `?token=${token}` : ""}`
      : "";
  }

  private get headers() {
    return { apikey: this.apiKey, "Content-Type": "application/json" };
  }

  async createInstance(instanceName: string) {
    let result: any;
    try {
      const { data } = await axios.post(
        `${this.apiUrl}/instance/create`,
        { instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" },
        { headers: this.headers }
      );
      result = data;
    } catch (err: any) {
      // A Evolution retorna 403/409 quando a instância já existe.
      // Isso não é erro: o usuário só quer (re)conectar, então seguimos
      // adiante e deixamos o fluxo buscar o QR pela instância existente.
      const status = err?.response?.status;
      if (status === 403 || status === 409) {
        this.logger.log(`Instância ${instanceName} já existe; reutilizando.`);
        result = { instanceName, alreadyExists: true };
      } else {
        throw err;
      }
    }
    // Cada cargo tem o seu WhatsApp; sem isto a ENTRADA de mensagens não chega no
    // CRM. Configuramos o webhook da instância (idempotente) sempre que ela é
    // criada/reconectada, para não depender de ajuste manual por usuário.
    await this.ensureWebhook(instanceName);
    return result;
  }

  async getQrCode(instanceName: string) {
    // Reforço: garante o webhook também no fluxo de reconexão (buscar QR).
    await this.ensureWebhook(instanceName);
    const { data } = await axios.get(
      `${this.apiUrl}/instance/connect/${instanceName}`,
      { headers: this.headers }
    );
    return data;
  }

  /**
   * Aponta o webhook da instância para este backend, ativando o evento de
   * mensagem recebida (MESSAGES_UPSERT). Idempotente e tolerante a falha: se der
   * erro (ou faltar a URL pública), apenas registra um aviso — não quebra a
   * conexão do WhatsApp.
   */
  async ensureWebhook(instanceName: string) {
    if (!this.webhookUrl) {
      this.logger.warn(
        "WEBHOOK_PUBLIC_URL/RAILWAY_PUBLIC_DOMAIN ausente — webhook da instância NÃO configurado."
      );
      return;
    }
    try {
      await axios.post(
        `${this.apiUrl}/webhook/set/${instanceName}`,
        {
          webhook: {
            enabled: true,
            url: this.webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ["MESSAGES_UPSERT"],
          },
        },
        { headers: this.headers }
      );
      this.logger.log(`Webhook da instância ${instanceName} configurado.`);
    } catch (err: any) {
      this.logger.warn(
        `Falha ao configurar webhook de ${instanceName}: ${err?.response?.status ?? ""} ${
          err?.message ?? ""
        }`
      );
    }
  }

  async getInstanceStatus(instanceName: string) {
    const { data } = await axios.get(
      `${this.apiUrl}/instance/connectionState/${instanceName}`,
      { headers: this.headers }
    );
    return data;
  }

  async sendText(instanceName: string, to: string, text: string) {
    // Evolution API v2 espera { number, text }. Se já vier um JID completo
    // (grupo @g.us ou contato @s.whatsapp.net) usamos como está; senão
    // mandamos só os dígitos e a Evolution resolve o destino.
    const number = to.includes("@") ? to : to.replace(/\D/g, "");
    const { data } = await axios.post(
      `${this.apiUrl}/message/sendText/${instanceName}`,
      { number, text },
      { headers: this.headers }
    );
    this.logger.log(`Mensagem enviada para ${number} via ${instanceName}`);
    return data;
  }

  /** Busca a URL da foto de perfil de um contato. Retorna null se não houver/for privada. */
  async fetchProfilePicture(instanceName: string, number: string): Promise<string | null> {
    try {
      const num = number.includes("@") ? number : number.replace(/\D/g, "");
      const { data } = await axios.post(
        `${this.apiUrl}/chat/fetchProfilePictureUrl/${instanceName}`,
        { number: num },
        { headers: this.headers }
      );
      return data?.profilePictureUrl || data?.profilePicUrl || null;
    } catch {
      // Foto privada, contato inexistente ou instância desconectada — segue sem foto.
      return null;
    }
  }

  /** Baixa a mídia de uma mensagem (base64) via Evolution. Retorna null se falhar. */
  async getMediaBase64(
    instanceName: string,
    message: any
  ): Promise<{ base64: string; mimetype: string } | null> {
    try {
      const { data } = await axios.post(
        `${this.apiUrl}/chat/getBase64FromMediaMessage/${instanceName}`,
        { message },
        { headers: this.headers }
      );
      const base64 = data?.base64 || data?.media?.base64;
      const mimetype = data?.mimetype || data?.media?.mimetype || "application/octet-stream";
      if (!base64) return null;
      return { base64, mimetype };
    } catch (err) {
      this.logger.warn(`Falha ao baixar mídia: ${(err as Error).message}`);
      return null;
    }
  }

  /** Busca nome (subject) e foto de um grupo pelo JID (@g.us). */
  async fetchGroupInfo(
    instanceName: string,
    groupJid: string
  ): Promise<{ name: string | null; avatar: string | null }> {
    try {
      const { data } = await axios.get(
        `${this.apiUrl}/group/findGroupInfos/${instanceName}`,
        { headers: this.headers, params: { groupJid } }
      );
      const info = Array.isArray(data) ? data[0] : data;
      return { name: info?.subject || null, avatar: info?.pictureUrl || null };
    } catch {
      return { name: null, avatar: null };
    }
  }

  async deleteInstance(instanceName: string) {
    const { data } = await axios.delete(
      `${this.apiUrl}/instance/delete/${instanceName}`,
      { headers: this.headers }
    );
    return data;
  }

  async listInstances() {
    const { data } = await axios.get(
      `${this.apiUrl}/instance/fetchInstances`,
      { headers: this.headers }
    );
    return data;
  }
}
