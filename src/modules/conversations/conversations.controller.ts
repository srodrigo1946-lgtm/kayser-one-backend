import { Controller, Get, Patch, Body, Param, UseGuards, Request, Res } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { ConversationsService } from "./conversations.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Conversas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  @ApiOperation({ summary: "Listar conversas (por hierarquia)" })
  list(@Request() req: any) {
    return this.conversationsService.list(req.user);
  }

  @Get(":id/messages")
  @ApiOperation({ summary: "Mensagens de uma conversa" })
  messages(@Param("id") id: string, @Request() req: any) {
    return this.conversationsService.getMessages(id, req.user);
  }

  @Patch(":id/assign")
  @ApiOperation({ summary: "Atribuir/trocar o atendente da conversa (userId null p/ remover)" })
  assign(@Param("id") id: string, @Body() body: { userId: string | null }, @Request() req: any) {
    return this.conversationsService.assign(id, body?.userId ?? null, req.user);
  }

  @Patch(":id/etiquetas")
  @ApiOperation({ summary: "Definir as etiquetas da conversa (integra Kanban + Agenda)" })
  etiquetas(@Param("id") id: string, @Body() body: { etiquetas: string[] }, @Request() req: any) {
    return this.conversationsService.setEtiquetas(id, body?.etiquetas ?? [], req.user);
  }
}

/**
 * Serve a mídia das mensagens. Requer JWT (via header OU `?token=` para funcionar
 * dentro de <img>/<audio>) e valida o escopo por equipe no service.
 */
@ApiTags("Conversas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("conversations")
export class ConversationsMediaController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get("media/:messageId")
  @ApiOperation({ summary: "Baixar/exibir a mídia de uma mensagem" })
  async media(@Param("messageId") messageId: string, @Res() res: Response, @Request() req: any) {
    const f = await this.conversationsService.getMessageMedia(messageId, req.user);
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(f.buffer);
  }
}
