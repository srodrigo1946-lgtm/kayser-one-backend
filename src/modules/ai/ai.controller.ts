import { Controller, Post, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsOptional, IsString } from "class-validator";
import { AiService } from "./ai.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

class ChatDto {
  @IsArray()
  messages: { role: "user" | "assistant"; content: string }[];

  @IsOptional()
  @IsString()
  apiKey?: string;
}

@ApiTags("IA")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("ai")
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post("chat")
  @ApiOperation({ summary: "Chat com a Kayser One AI" })
  chat(@Body() dto: ChatDto) {
    return this.aiService.chat(dto.messages, dto.apiKey);
  }

  @Post("qualify/:leadId")
  @ApiOperation({ summary: "Qualificar lead automaticamente com IA" })
  qualify(
    @Param("leadId") leadId: string,
    @Body() body: { conversation: string; apiKey?: string }
  ) {
    return this.aiService.qualifyLead(leadId, body.conversation, body.apiKey);
  }
}
