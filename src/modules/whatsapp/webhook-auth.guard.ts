import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Protege o webhook público da Evolution API com um segredo compartilhado.
 *
 * Aceita o token por header `x-webhook-token` / `apikey` ou por query `?token=`.
 * Comportamento seguro-mas-compatível: se `WHATSAPP_WEBHOOK_TOKEN` NÃO estiver
 * configurado, libera (apenas registra um aviso) para não derrubar uma integração
 * já ativa. Assim que a env for definida, o token passa a ser obrigatório.
 *
 * Para ativar: definir WHATSAPP_WEBHOOK_TOKEN no backend e apontar o webhook da
 * Evolution para `.../whatsapp/webhook?token=<valor>` (ou enviar o header).
 */
@Injectable()
export class WebhookAuthGuard implements CanActivate {
  private readonly logger = new Logger(WebhookAuthGuard.name);
  private warned = false;

  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>("WHATSAPP_WEBHOOK_TOKEN");
    if (!expected) {
      if (!this.warned) {
        this.logger.warn(
          "WHATSAPP_WEBHOOK_TOKEN não configurado — webhook do WhatsApp está ABERTO. Configure a env para proteger."
        );
        this.warned = true;
      }
      return true;
    }
    const req = ctx.switchToHttp().getRequest();
    const provided =
      req.headers?.["x-webhook-token"] || req.headers?.["apikey"] || req.query?.token;
    if (provided && provided === expected) return true;
    throw new UnauthorizedException("Webhook token inválido.");
  }
}
