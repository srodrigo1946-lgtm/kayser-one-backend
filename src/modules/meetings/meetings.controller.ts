import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from "@nestjs/common";
import { IsArray, IsInt, IsOptional, IsString, Min } from "class-validator";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { MeetingsService } from "./meetings.service";

class CreateMeetingDto {
  @IsString() title: string;
  @IsString() scheduledAt: string;
  @IsOptional() @IsInt() @Min(15) durationMin?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) participantIds?: string[];
}

class UpdateMeetingDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() scheduledAt?: string;
  @IsOptional() @IsInt() @Min(15) durationMin?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) participantIds?: string[];
  @IsOptional() @IsString() status?: string;
}

@ApiTags("Reuniões")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("meetings")
export class MeetingsController {
  constructor(private readonly service: MeetingsService) {}

  @Get()
  @ApiOperation({ summary: "Listar reuniões (por hierarquia)" })
  list(@Request() req: any) {
    return this.service.findAll(req.user);
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe da reunião" })
  get(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: "Criar reunião (gera sala + trava a Agenda)" })
  create(@Body() dto: CreateMeetingDto, @Request() req: any) {
    return this.service.create(dto, req.user);
  }

  @Put(":id")
  @ApiOperation({ summary: "Editar reunião" })
  update(@Param("id") id: string, @Body() dto: UpdateMeetingDto) {
    const patch: any = { ...dto };
    if (dto.scheduledAt) patch.scheduledAt = new Date(dto.scheduledAt);
    return this.service.update(id, patch);
  }

  @Put(":id/notes")
  @ApiOperation({ summary: "Salvar anotações da reunião" })
  notes(@Param("id") id: string, @Body("notes") notes: string) {
    return this.service.setNotes(id, notes ?? "");
  }

  @Delete(":id")
  @ApiOperation({ summary: "Cancelar reunião (remove da Agenda)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
