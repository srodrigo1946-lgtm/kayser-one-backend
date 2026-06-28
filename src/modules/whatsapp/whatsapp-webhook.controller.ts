import { Controller, Post, Body, HttpCode } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { WhatsappFlowService } from "./whatsapp-flow.service";

/**
 * Endpoint público que recebe os eventos da Evolution API.
 * Configure o webhook da Evolution para: {BACKEND_URL}/api/v1/whatsapp/webhook
 * (sem autenticação JWT, pois é chamado por um serviço externo).
 */
@ApiTags("WhatsApp")
@Controller("whatsapp/webhook")
export class WhatsappWebhookController {
  constructor(private readonly flowService: WhatsappFlowService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: "Webhook da Evolution API (eventos de mensagens)" })
  receive(@Body() payload: any) {
    return this.flowService.handleInbound(payload);
  }
}
