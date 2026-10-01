import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { SettingsService } from "../settings/settings.service";
import { ConfigService } from "@nestjs/config";
import axios from "axios";

const EVOLUTION_FORA =
  "WhatsApp (Evolution API) indisponível no momento. Verifique/reinicie o serviço da Evolution no Railway e tente de novo.";

/**
 * Traduz o erro da Evolution pro motivo REAL (antes tudo virava "indisponível" e
 * ninguém sabia se era a Evolution fora, o número desconectado ou o cliente sem WhatsApp).
 */
export function erroEvolution(err: any, instanceName: string): Error {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const texto = JSON.stringify(data ?? "").toLowerCase();
  // Sem resposta nenhuma = a Evolution não atendeu (fora do ar / rede).
  if (!err?.response) return new ServiceUnavailableException(EVOLUTION_FORA);
  if (texto.includes('"exists":false') || texto.includes("not exist") && texto.includes("number")) {
    return new BadRequestException("Esse número não tem WhatsApp (a Evolution não encontrou a conta). Confira o telefone do cliente.");
  }
  if (status === 404 || texto.includes("not found") || texto.includes("does not exist")) {
    return new ServiceUnavailableException(
      `O WhatsApp que envia esta conversa (${instanceName}) não está conectado. Reconecte pelo QR Code em Conversas ao vivo e tente de novo.`
    );
  }
  if (texto.includes("connection closed") || texto.includes("not connected") || texto.includes("close")) {
    return new ServiceUnavailableException(
      `O WhatsApp que envia esta conversa (${instanceName}) caiu/desconectou. Reconecte pelo QR Code em Conversas ao vivo e tente de novo.`
    );
  }
  if (status === 401 || status === 403) {
    return new ServiceUnavailableException("A Evolution recusou a chave de acesso (EVOLUTION_API_KEY no Railway).");
  }
  const msg = (data?.response?.message ?? data?.message ?? err?.message ?? "erro desconhecido").toString().slice(0, 200);
  return new ServiceUnavailableException(`WhatsApp não enviou (Evolution ${status}): ${msg}`);
}

/** Cliente pediu pra parar ("pare", "não quero mais", "sair da lista"...). */
export function pedeParar(texto?: string | null): boolean {
  const t = (texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!t || t.length > 120) return false;
  return /^(pare|para|parar|sair|stop|chega)[.!]*$/.test(t) ||
    /(nao (quero|tenho) (mais )?(interesse|receber|mensage)|para(r)? de (me )?(mandar|enviar)|pare de (me )?(mandar|enviar)|me (tira|tire|remova|remove) (da|dessa|desta) lista|descadastr|nao me (mande|mandem|envie|enviem))/.test(t);
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly webhookUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService
  ) {
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

  private pausaCache: { em: number; valor: boolean } | null = null;
  private ultimoEnvio = new Map<string, number>();

  /**
   * PROTEÇÃO: nunca dispara 2 mensagens coladas pelo mesmo número (1,5 a 3,5s entre
   * elas, com variação — robô manda em ritmo fixo, gente não).
   */
  private async espacar(instanceName: string) {
    const gap = 1500 + Math.random() * 2000;
    const espera = (this.ultimoEnvio.get(instanceName) ?? 0) + gap - Date.now();
    this.ultimoEnvio.set(instanceName, Date.now() + Math.max(espera, 0));
    if (espera > 0) await dormir(espera);
  }

  /**
   * PROTEÇÃO pra envio em MASSA (follow-up, 1ª mensagem pendente): pausa de 25 a 60s
   * entre um cliente e outro. Disparo seguido é o que mais faz o WhatsApp bloquear.
   */
  async pausaEntreDisparos() {
    await dormir(25_000 + Math.random() * 35_000);
  }

  /** "digitando..." proporcional ao tamanho do texto (1,2 a 5s). */
  private digitando(texto: string): number {
    return Math.min(5000, 1200 + (texto?.length ?? 0) * 25);
  }

  /** Contingência ligada em Configurações? (cache de 30s pra não bater no banco a cada envio) */
  async pausado(): Promise<boolean> {
    if (this.pausaCache && Date.now() - this.pausaCache.em < 30_000) return this.pausaCache.valor;
    const s = await this.settings.get().catch(() => null);
    this.pausaCache = { em: Date.now(), valor: !!s?.whatsappPausado };
    return this.pausaCache.valor;
  }

  private async bloqueiaSePausado() {
    if (await this.pausado()) {
      throw new ServiceUnavailableException(
        "WhatsApp central PAUSADO (contingência). Os leads continuam entrando na fila; o envio volta quando o Diretor desligar a pausa em Configurações."
      );
    }
  }

  private conexaoCache = new Map<string, { ok: boolean; em: number }>();

  /** O número (instância) está conectado na Evolution? (cache de 2 min) */
  async conectado(instanceName: string): Promise<boolean> {
    const c = this.conexaoCache.get(instanceName);
    if (c && Date.now() - c.em < 120_000) return c.ok;
    let ok = false;
    try {
      const data = await this.getInstanceStatus(instanceName);
      const st = data?.instance?.state ?? data?.state;
      ok = st === "open";
    } catch {
      ok = false;
    }
    this.conexaoCache.set(instanceName, { ok, em: Date.now() });
    return ok;
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
        this.logger.error(`Evolution /instance/create falhou: ${err?.message}`);
        throw new ServiceUnavailableException(EVOLUTION_FORA);
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
    try {
      const { data } = await axios.get(
        `${this.apiUrl}/instance/connect/${instanceName}`,
        { headers: this.headers }
      );
      return data;
    } catch (err: any) {
      this.logger.error(`Evolution /instance/connect falhou: ${err?.message}`);
      throw new ServiceUnavailableException(EVOLUTION_FORA);
    }
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

  /**
   * Envia mídia (imagem, PDF, Excel...) pelo WhatsApp. Evolution v2 espera
   * { number, mediatype, mimetype, media (base64 puro), fileName, caption }.
   * mediatype: "image" para fotos; "document" para PDF/Excel/etc.
   */
  async sendMedia(
    instanceName: string,
    to: string,
    file: { base64: string; mimetype: string; fileName: string; caption?: string }
  ) {
    const number = to.includes("@") ? to : to.replace(/\D/g, "");
    const mediatype = file.mimetype.startsWith("image/")
      ? "image"
      : file.mimetype.startsWith("video/")
        ? "video"
        : "document";
    await this.bloqueiaSePausado();
    await this.espacar(instanceName);
    // Aceita data URI ("data:...;base64,XXX") ou base64 puro.
    const media = file.base64.includes(",") ? file.base64.split(",")[1] : file.base64;
    try {
      const { data } = await axios.post(
        `${this.apiUrl}/message/sendMedia/${instanceName}`,
        {
          number,
          mediatype,
          mimetype: file.mimetype,
          media,
          fileName: file.fileName,
          ...(file.caption ? { caption: file.caption } : {}),
        },
        { headers: this.headers }
      );
      this.logger.log(`Mídia (${mediatype}) enviada para ${number} via ${instanceName}`);
      return data;
    } catch (err: any) {
      this.logger.error(`Evolution /sendMedia falhou (${instanceName}): ${err?.response?.status ?? ""} ${JSON.stringify(err?.response?.data ?? err?.message).slice(0, 300)}`);
      throw erroEvolution(err, instanceName);
    }
  }

  /** Mensagem de VOZ (ptt) — áudio em base64 (ogg/opus). */
  async sendAudio(instanceName: string, to: string, base64: string) {
    await this.bloqueiaSePausado();
    await this.espacar(instanceName);
    const number = to.includes("@") ? to : to.replace(/\D/g, "");
    try {
      const { data } = await axios.post(
        `${this.apiUrl}/message/sendWhatsAppAudio/${instanceName}`,
        { number, audio: base64, encoding: true },
        { headers: this.headers }
      );
      this.logger.log(`Áudio enviado para ${number} via ${instanceName}`);
      return data;
    } catch (err: any) {
      this.logger.error(`Evolution /sendWhatsAppAudio falhou (${instanceName}): ${err?.response?.status ?? ""} ${JSON.stringify(err?.response?.data ?? err?.message).slice(0, 300)}`);
      throw erroEvolution(err, instanceName);
    }
  }

  async sendText(instanceName: string, to: string, text: string) {
    // Evolution API v2 espera { number, text }. Se já vier um JID completo
    // (grupo @g.us ou contato @s.whatsapp.net) usamos como está; senão
    // mandamos só os dígitos e a Evolution resolve o destino.
    const number = to.includes("@") ? to : to.replace(/\D/g, "");
    await this.bloqueiaSePausado();
    await this.espacar(instanceName);
    try {
      const { data } = await axios.post(
        `${this.apiUrl}/message/sendText/${instanceName}`,
        { number, text, delay: this.digitando(text) },
        { headers: this.headers }
      );
      this.logger.log(`Mensagem enviada para ${number} via ${instanceName}`);
      return data;
    } catch (err: any) {
      this.logger.error(`Evolution /sendText falhou (${instanceName}): ${err?.response?.status ?? ""} ${JSON.stringify(err?.response?.data ?? err?.message).slice(0, 300)}`);
      throw erroEvolution(err, instanceName);
    }
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
