import { Body, Controller, Get, Param, Post, Put, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Min } from "class-validator";
import { LeadQueueService } from "./lead-queue.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DiretorGuard } from "../auth/guards/diretor.guard";

class UpdateQueueDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) slaMinutes?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) memberIds?: string[];
}

class AgendarDto {
  // Horário futuro em ISO (o front manda o datetime-local convertido pra ISO).
  @IsISO8601() quando!: string;
}

@ApiTags("Fila de Leads")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("lead-queue")
export class LeadQueueController {
  constructor(private readonly queue: LeadQueueService) {}

  @Get("settings")
  @ApiOperation({ summary: "Configuração atual da fila" })
  getSettings() {
    return this.queue.getSettings();
  }

  @Put("settings")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Atualizar a fila (somente Diretor)" })
  update(@Body() dto: UpdateQueueDto) {
    return this.queue.updateSettings(dto);
  }

  @Get("board")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Painel do dia (somente Diretor)" })
  board() {
    return this.queue.getBoard();
  }

  @Get("pendentes")
  @ApiOperation({ summary: "Atribuições pendentes (leadId + prazo) para o relógio no card" })
  pendentes() {
    return this.queue.getPendentes();
  }

  @Get("ordem")
  @ApiOperation({ summary: "Ordem da fila agora (todos os cargos VEEM, só leitura)" })
  ordem(@Request() req: any) {
    return this.queue.getOrdem(req.user);
  }

  @Post("testar-email")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Testa o disparo de e-mail de novo lead (envia pro Diretor)" })
  testarEmail(@Request() req: any) {
    return this.queue.testarEmail(req.user);
  }

  @Post("distribuir/:leadId")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Joga um lead manual no rodízio de plantão (somente Diretor)" })
  distribuir(@Param("leadId") leadId: string) {
    return this.queue.distribuirLeadManual(leadId);
  }

  @Post("agendar/:leadId")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Agenda um lead pra cair no rodízio num horário futuro (somente Diretor)" })
  agendar(@Param("leadId") leadId: string, @Body() dto: AgendarDto) {
    return this.queue.agendarLead(leadId, new Date(dto.quando));
  }
}
