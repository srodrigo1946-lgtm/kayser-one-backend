import { Controller, Get, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
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
  messages(@Param("id") id: string) {
    return this.conversationsService.getMessages(id);
  }
}
