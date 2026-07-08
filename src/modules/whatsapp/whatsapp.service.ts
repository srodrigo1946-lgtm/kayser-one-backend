import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiUrl = config.get("EVOLUTION_API_URL", "http://localhost:8080");
    this.apiKey = config.get("EVOLUTION_API_KEY", "");
  }

  private get headers() {
    return { apikey: this.apiKey, "Content-Type": "application/json" };
  }

  async createInstance(instanceName: string) {
    try {
      const { data } = await axios.post(
        `${this.apiUrl}/instance/create`,
        { instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" },
        { headers: this.headers }
      );
      return data;
    } catch (err: any) {
      // A Evolution retorna 403/409 quando a instância já existe.
      // Isso não é erro: o usuário só quer (re)conectar, então seguimos
      // adiante e deixamos o fluxo buscar o QR pela instância existente.
      const status = err?.response?.status;
      if (status === 403 || status === 409) {
        this.logger.log(`Instância ${instanceName} já existe; reutilizando.`);
        return { instanceName, alreadyExists: true };
      }
      throw err;
    }
  }

  async getQrCode(instanceName: string) {
    const { data } = await axios.get(
      `${this.apiUrl}/instance/connect/${instanceName}`,
      { headers: this.headers }
    );
    return data;
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
