import { Controller, Post, Body, HttpCode, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { WhatsappFlowService } from "./whatsapp-flow.service";
import { WebhookAuthGuard } from "./webhook-auth.guard";

/**
 * Endpoint público que recebe os eventos da Evolution API.
 * Configure o webhook da Evolution para: {BACKEND_URL}/api/v1/whatsapp/webhook?token=<WHATSAPP_WEBHOOK_TOKEN>
 * (sem JWT, pois é um serviço externo; protegido por token compartilhado via WebhookAuthGuard).
 */
@ApiTags("WhatsApp")
@Controller("whatsapp/webhook")
@UseGuards(WebhookAuthGuard)
@SkipThrottle()
export class WhatsappWebhookController {
  constructor(private readonly flowService: WhatsappFlowService) {}

  // Aceita tanto a URL base (`/whatsapp/webhook`) quanto os sub-paths por evento
  // (`/whatsapp/webhook/messages-upsert`, `/connection-update`, etc.). A Evolution,
  // com "Webhook por Eventos" ligado, anexa o nome do evento ao path — sem o curinga
  // esses POSTs caíam em 404 e nenhuma mensagem chegava ao CRM. O handler é o mesmo:
  // o flow ignora o que não for mensagem.
  @Post(["", "*"])
  @HttpCode(200)
  @ApiOperation({ summary: "Webhook da Evolution API (eventos de mensagens)" })
  receive(@Body() payload: any) {
    return this.flowService.handleInbound(payload);
  }
}
