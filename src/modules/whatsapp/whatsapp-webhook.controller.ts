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

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: "Webhook da Evolution API (eventos de mensagens)" })
  receive(@Body() payload: any) {
    return this.flowService.handleInbound(payload);
  }
}
