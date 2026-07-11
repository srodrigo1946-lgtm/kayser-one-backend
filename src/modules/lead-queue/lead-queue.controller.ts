import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from "class-validator";
import { LeadQueueService } from "./lead-queue.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DiretorGuard } from "../auth/guards/diretor.guard";

class UpdateQueueDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(1) slaMinutes?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) memberIds?: string[];
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
}
