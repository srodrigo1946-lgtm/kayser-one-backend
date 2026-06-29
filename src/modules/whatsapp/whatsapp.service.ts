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
    const number = to.replace(/\D/g, "");
    const { data } = await axios.post(
      `${this.apiUrl}/message/sendText/${instanceName}`,
      { number: `${number}@s.whatsapp.net`, textMessage: { text } },
      { headers: this.headers }
    );
    this.logger.log(`Mensagem enviada para ${number} via ${instanceName}`);
    return data;
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
