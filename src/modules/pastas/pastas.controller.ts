import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, Res } from "@nestjs/common";
import { Response } from "express";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PastasService } from "./pastas.service";
import { CreatePastaDto } from "./dto/create-pasta.dto";
import { UpdatePastaDto } from "./dto/update-pasta.dto";

const num = (v?: string) => (v != null && v !== "" ? Number(v) : undefined);

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

  @Get("ranking/analises")
  @ApiOperation({ summary: "Ranking de análises por responsável (só Gerente Geral pra cima)" })
  ranking(@Request() req: any, @Query("year") year?: string, @Query("month") month?: string) {
    return this.service.analysesRanking(req.user, num(year), num(month));
  }

  @Get("ranking/analises/export")
  @ApiOperation({ summary: "Exporta as análises em Excel (só Diretor)" })
  async exportRanking(
    @Request() req: any,
    @Res() res: Response,
    @Query("year") year?: string,
    @Query("month") month?: string
  ) {
    const buf = await this.service.exportAnalyses(req.user, num(year), num(month));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="ranking-analises.xlsx"');
    res.send(buf);
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

  @Post(":id/pendencia")
  @ApiOperation({ summary: "Pede um documento pendente (novo espaço no mesmo link)" })
  pendencia(@Request() req: any, @Param("id") id: string, @Body("label") label: string) {
    return this.service.addPendencia(id, label, req.user);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Exclui a pasta e o ambiente de documentos (só Diretor)" })
  remove(@Request() req: any, @Param("id") id: string) {
    return this.service.remove(id, req.user);
  }

  @Get(":id/files")
  @ApiOperation({ summary: "Lista os documentos recebidos da pasta (empresa/gestor)" })
  listFiles(@Request() req: any, @Param("id") id: string) {
    return this.service.listFiles(id, req.user);
  }

  @Post(":id/release")
  @ApiOperation({ summary: "Libera/reabre a janela de 40 min p/ a empresa (corretor/Diretor)" })
  release(@Request() req: any, @Param("id") id: string) {
    return this.service.releaseDocs(id, req.user);
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
