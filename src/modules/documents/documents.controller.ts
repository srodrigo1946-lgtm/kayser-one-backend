import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
  UploadedFile,
  UseInterceptors,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ConfigService } from "@nestjs/config";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Response } from "express";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { DocumentsService } from "./documents.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

class CreateRequestDto {
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() conversationId?: string;
  @IsString() clientName: string;
  @IsOptional() @IsString() clientPhone?: string;
  @IsOptional() @IsString() fase?: string;
  @IsOptional() @IsString() perfil?: string;
  @IsOptional() @IsString() estadoCivil?: string;
  @IsOptional() @IsBoolean() declaraIR?: boolean;
}

@ApiTags("Documentos")
@Controller()
export class DocumentsController {
  constructor(
    private readonly service: DocumentsService,
    private readonly config: ConfigService
  ) {}

  // ---------------- Gestor (autenticado) ----------------

  @Post("documents/request")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Gerar link de coleta de documentos" })
  async createRequest(@Body() dto: CreateRequestDto, @Request() req: any) {
    const created = await this.service.createRequest(dto, req.user.id);
    const base = this.config.get<string>("FRONTEND_URL", "");
    return { token: created.token, link: `${base}/docs/${created.token}` };
  }

  @Get("documents/conversation/:id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Solicitações/progresso de documentos de uma conversa" })
  findByConversation(@Param("id") id: string, @Request() req: any) {
    return this.service.findByConversation(id, req.user);
  }

  @Get("documents/request/:id/files")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Arquivos recebidos de uma solicitação" })
  listFiles(@Param("id") id: string, @Request() req: any) {
    return this.service.listFiles(id, req.user);
  }

  @Get("documents/file/:docId")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Baixar um documento" })
  async download(@Param("docId") docId: string, @Res() res: Response, @Request() req: any) {
    const f = await this.service.getFile(docId, req.user);
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${f.filename}"`);
    res.send(f.buffer);
  }

  // ---------------- Organização do R2 (autenticada) ----------------

  @Post("documents/migrate-r2")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Organizar documentos no R2 em pastas amigáveis (idempotente)" })
  migrateR2() {
    return this.service.organizeR2();
  }

  // ---------------- Público (cliente, sem login) ----------------

  @Get("docs/:token")
  @ApiOperation({ summary: "Checklist público do link de documentos" })
  getPublic(@Param("token") token: string) {
    return this.service.getByToken(token);
  }

  @Post("docs/:token/upload")
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Upload público de um documento" })
  uploadPublic(
    @Param("token") token: string,
    @Body("tipo") tipo: string,
    @UploadedFile() file: Express.Multer.File
  ) {
    return this.service.upload(token, tipo, file);
  }
}
