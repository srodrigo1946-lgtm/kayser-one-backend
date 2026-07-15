import { Injectable, BadRequestException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import { Repository } from "typeorm";
import { SupportMessage } from "./support-message.entity";

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportMessage)
    private readonly repo: Repository<SupportMessage>,
    private readonly config: ConfigService
  ) {}

  /** Cria uma mensagem vinda da caixinha pública (sem login). */
  async create(data: { name?: string; email?: string; type?: string; message?: string }) {
    const message = (data.message || "").trim();
    if (message.length < 3) throw new BadRequestException("Escreva a sua mensagem.");
    const type = data.type === "reclamacao" ? "reclamacao" : "suporte";
    const msg = this.repo.create({
      name: (data.name || "").trim() || undefined,
      email: (data.email || "").trim() || undefined,
      type,
      message: message.slice(0, 4000),
    });
    await this.repo.save(msg);
    // Notifica por e-mail (best-effort): só envia se RESEND_API_KEY estiver setado.
    await this.notifyByEmail(msg);
    return { ok: true };
  }

  /**
   * Envia a mensagem por e-mail via Resend (https://resend.com), se configurado.
   * Sem RESEND_API_KEY, é no-op — a mensagem fica só no painel. Nunca quebra o create.
   */
  private async notifyByEmail(msg: SupportMessage) {
    const apiKey = this.config.get<string>("RESEND_API_KEY");
    if (!apiKey) return;
    const to = this.config.get<string>("SUPPORT_NOTIFY_EMAIL", "srodrigo1946@gmail.com");
    const from = this.config.get<string>("SUPPORT_FROM", "Kayser One <onboarding@resend.dev>");
    const tipo = msg.type === "reclamacao" ? "Reclamação" : "Suporte";
    const text =
      `Nova mensagem de ${tipo} pela tela do Kayser One:\n\n` +
      `Nome: ${msg.name || "—"}\n` +
      `E-mail: ${msg.email || "—"}\n\n` +
      `Mensagem:\n${msg.message}\n`;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to,
          subject: `[${tipo}] Kayser One — ${msg.name || "contato"}`,
          text,
          reply_to: msg.email || undefined,
        }),
      });
      if (!res.ok) {
        this.logger.warn(`Resend falhou (${res.status}): ${await res.text()}`);
      }
    } catch (err) {
      this.logger.warn(`Falha ao enviar e-mail de suporte: ${(err as Error).message}`);
    }
  }

  list() {
    return this.repo.find({ order: { createdAt: "DESC" }, take: 200 });
  }

  async unreadCount() {
    const count = await this.repo.count({ where: { read: false } });
    return { count };
  }

  async markRead(id: string) {
    await this.repo.update({ id }, { read: true });
    return { ok: true };
  }

  async remove(id: string) {
    await this.repo.delete({ id });
    return { ok: true };
  }
}
