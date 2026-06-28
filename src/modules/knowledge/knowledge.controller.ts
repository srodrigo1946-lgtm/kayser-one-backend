import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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

  @Post("upload")
  @ApiOperation({ summary: "Treinar a IA enviando um arquivo (PDF, DOCX, XLSX, CSV, TXT)" })
  @UseInterceptors(FileInterceptor("file"))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title?: string; type?: KnowledgeType }
  ) {
    return this.knowledgeService.extractAndStore(file, { title: body?.title, type: body?.type });
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
