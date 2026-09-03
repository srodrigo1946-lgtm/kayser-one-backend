import { Controller, Get, Post, Delete, Query, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsIn, IsString, IsNotEmpty } from "class-validator";
import { FeedbackService } from "./feedback.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

class AddNoteDto {
  @IsIn(["user", "time"])
  alvoTipo: string;

  @IsString() @IsNotEmpty()
  alvoId: string;

  @IsString() @IsNotEmpty()
  texto: string;
}

@ApiTags("Feedback / 1-on-1")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("feedback")
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get()
  @ApiOperation({ summary: "Anotações de 1-on-1 de um alvo (pessoa ou time)" })
  list(@Query("alvoTipo") alvoTipo: string, @Query("alvoId") alvoId: string, @Request() req: any) {
    return this.service.list(alvoTipo || "user", alvoId, req.user);
  }

  @Post()
  @ApiOperation({ summary: "Registrar uma anotação de reunião" })
  add(@Body() dto: AddNoteDto, @Request() req: any) {
    return this.service.add(dto.alvoTipo, dto.alvoId, dto.texto, req.user);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Apagar uma anotação (autor ou Diretor)" })
  remove(@Param("id") id: string, @Request() req: any) {
    return this.service.remove(id, req.user);
  }
}
