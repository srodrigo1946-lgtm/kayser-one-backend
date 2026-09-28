import { Controller, Get, Post, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray } from "class-validator";
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

class ChatDto {
  @IsArray()
  messages: { role: "user" | "assistant"; content: string }[];
}

@ApiTags("IA")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("chat")
  @ApiOperation({ summary: "Chat com a Kayser One AI (usa a IA do usuário logado)" })
  // req.user não carrega mais a aiApiKey (select:false) — busca a config pelo id.
  async chat(@Body() dto: ChatDto, @Request() req: any) {
    return this.aiService.chat(dto.messages, await this.aiService.getUserAiConfig(req.user.id));
  }

  @Get("diagnostico-audio")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Diagnóstico da transcrição de áudio (só Diretor)" })
  diagnosticoAudio() {
    return this.aiService.diagnosticoAudio();
  }

  @Post("qualify/:leadId")
  @ApiOperation({ summary: "Qualificar lead automaticamente com IA" })
  async qualify(
    @Param("leadId") leadId: string,
    @Body() body: { conversation: string },
    @Request() req: any
  ) {
    return this.aiService.qualifyLead(
      leadId,
      body.conversation,
      await this.aiService.getUserAiConfig(req.user.id)
    );
  }
}
