import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { WhatsappService } from "./whatsapp.service";
import { WhatsappFlowService } from "./whatsapp-flow.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("WhatsApp")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("whatsapp")
export class WhatsappController {
  constructor(
    private readonly whatsappService: WhatsappService,
    private readonly flowService: WhatsappFlowService
  ) {}

  @Get("instances")
  @ApiOperation({ summary: "Listar sessões WhatsApp ativas" })
  listInstances() {
    return this.whatsappService.listInstances();
  }

  @Post("instance")
  @ApiOperation({ summary: "Criar sessão WhatsApp para um usuário" })
  createInstance(@Request() req: any) {
    return this.whatsappService.createInstance(`user_${req.user.id}`);
  }

  @Get("instance/qr")
  @ApiOperation({ summary: "Obter QR Code para conectar WhatsApp" })
  getQr(@Request() req: any) {
    return this.whatsappService.getQrCode(`user_${req.user.id}`);
  }

  @Get("instance/status")
  @ApiOperation({ summary: "Status da sessão WhatsApp" })
  getStatus(@Request() req: any) {
    return this.whatsappService.getInstanceStatus(`user_${req.user.id}`);
  }

  @Post("send")
  @ApiOperation({ summary: "Enviar mensagem de texto (registra na conversa)" })
  sendMessage(
    @Body() body: { to: string; text: string },
    @Request() req: any
  ) {
    return this.flowService.sendManual(`user_${req.user.id}`, body.to, body.text);
  }

  @Delete("instance")
  @ApiOperation({ summary: "Desconectar sessão WhatsApp" })
  deleteInstance(@Request() req: any) {
    return this.whatsappService.deleteInstance(`user_${req.user.id}`);
  }
}
