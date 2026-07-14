import { Controller, Get, Post, Put, Body, Param, UseGuards, Request, Res } from "@nestjs/common";
import { Response } from "express";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PastasService } from "./pastas.service";
import { CreatePastaDto } from "./dto/create-pasta.dto";
import { UpdatePastaDto } from "./dto/update-pasta.dto";

@ApiTags("Pastas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("pastas")
export class PastasController {
  constructor(private readonly service: PastasService) {}

  @Get()
  @ApiOperation({ summary: "Lista pastas de análise (por hierarquia)" })
  list(@Request() req: any) {
    return this.service.list(req.user);
  }

  @Post()
  @ApiOperation({ summary: "Cria pasta de análise" })
  create(@Request() req: any, @Body() dto: CreatePastaDto) {
    return this.service.create(dto, req.user);
  }

  @Get(":id")
  findOne(@Request() req: any, @Param("id") id: string) {
    return this.service.findOne(id, req.user);
  }

  @Put(":id")
  update(@Request() req: any, @Param("id") id: string, @Body() dto: UpdatePastaDto) {
    return this.service.update(id, dto, req.user);
  }

  @Put(":id/status")
  @ApiOperation({ summary: "Atualiza o status da pasta" })
  updateStatus(@Request() req: any, @Param("id") id: string, @Body("status") status: string) {
    return this.service.updateStatus(id, status, req.user);
  }

  @Post(":id/documents")
  @ApiOperation({ summary: "Garante o ambiente de documentos e devolve o token" })
  documents(@Request() req: any, @Param("id") id: string) {
    return this.service.ensureDocuments(id, req.user);
  }

  @Get(":id/files")
  @ApiOperation({ summary: "Lista os documentos recebidos da pasta (empresa/gestor)" })
  listFiles(@Request() req: any, @Param("id") id: string) {
    return this.service.listFiles(id, req.user);
  }

  @Get(":id/files/:docId")
  @ApiOperation({ summary: "Abre/baixa um documento da pasta" })
  async getFile(
    @Request() req: any,
    @Param("id") id: string,
    @Param("docId") docId: string,
    @Res() res: Response
  ) {
    const f = await this.service.getFile(id, docId, req.user);
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${f.filename}"`);
    res.send(f.buffer);
  }
}
