import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { Response } from "express";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { LeadsService } from "./leads.service";
import { CreateLeadDto } from "./dto/create-lead.dto";
import { UpdateLeadDto } from "./dto/update-lead.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Leads")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("leads")
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @ApiOperation({ summary: "Listar leads com filtros" })
  findAll(
    @Query("status") status?: string,
    @Query("responsavelId") responsavelId?: string,
    @Query("search") search?: string,
    @Query("page") page?: number,
    @Query("limit") limit?: number,
    @Request() req?: any
  ) {
    return this.leadsService.findAll({ status, responsavelId, search, page, limit, user: req.user });
  }

  @Get(":id")
  @ApiOperation({ summary: "Buscar lead por ID (escopo por equipe)" })
  findOne(@Param("id") id: string, @Request() req: any) {
    return this.leadsService.findOne(id, req.user);
  }

  @Get(":id/history")
  @ApiOperation({ summary: "Histórico/timeline do lead (escopo por equipe)" })
  history(@Param("id") id: string, @Request() req: any) {
    return this.leadsService.findHistory(id, req.user);
  }

  @Post()
  @ApiOperation({ summary: "Criar novo lead" })
  create(@Body() dto: CreateLeadDto, @Request() req: any) {
    return this.leadsService.create(dto, req.user);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar lead (escopo por equipe)" })
  update(@Param("id") id: string, @Body() dto: UpdateLeadDto, @Request() req: any) {
    return this.leadsService.update(id, dto, req.user);
  }

  @Put(":id/status")
  @ApiOperation({ summary: "Mover lead no Kanban" })
  updateStatus(
    @Param("id") id: string,
    @Body() body: { status: string; order?: number },
    @Request() req: any
  ) {
    return this.leadsService.updateStatus(id, body.status, body.order, req.user);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Remover lead (escopo por equipe)" })
  remove(@Param("id") id: string, @Request() req: any) {
    return this.leadsService.remove(id, req.user);
  }

  @Post("import/excel")
  @ApiOperation({ summary: "Importar leads via Excel" })
  @UseInterceptors(FileInterceptor("file"))
  importExcel(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    return this.leadsService.importFromExcel(file, req.user);
  }

  @Get("export/excel")
  @ApiOperation({ summary: "Exportar leads para Excel" })
  async exportExcel(@Request() req: any, @Res() res: Response) {
    const buf = await this.leadsService.exportToExcel(req.user);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="leads-kayser-one.xlsx"');
    res.send(buf);
  }
}
