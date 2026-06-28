import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsOptional, IsString } from "class-validator";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeType } from "./knowledge.entity";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

class UpsertKnowledgeDto {
  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional() @IsEnum(KnowledgeType)
  type?: KnowledgeType;

  @IsOptional() @IsBoolean()
  active?: boolean;
}

@ApiTags("Base de Conhecimento")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  @ApiOperation({ summary: "Listar itens da base de conhecimento" })
  findAll() {
    return this.knowledgeService.findAll();
  }

  @Post()
  @ApiOperation({ summary: "Adicionar item à base de conhecimento" })
  create(@Body() dto: UpsertKnowledgeDto) {
    return this.knowledgeService.create(dto);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar item" })
  update(@Param("id") id: string, @Body() dto: Partial<UpsertKnowledgeDto>) {
    return this.knowledgeService.update(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Remover item" })
  remove(@Param("id") id: string) {
    return this.knowledgeService.remove(id);
  }
}
