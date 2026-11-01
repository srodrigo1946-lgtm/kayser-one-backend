import { Body, Controller, ForbiddenException, Get, Param, Put, Query, Request, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsString } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { ReengajamentoService } from "./reengajamento.service";

/** Acompanhamento do reengajamento dos "sem interesse" (só Diretor). */
@ApiTags("Reengajamento")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DIRETOR)
@Controller("reengajamento")
export class ReengajamentoController {
  constructor(private readonly reengajamento: ReengajamentoService) {}

  @Get("painel")
  @ApiOperation({ summary: "Enviados, sim (fila), não (removidos), aguardando e últimas respostas" })
  painel() {
    return this.reengajamento.painel();
  }

  @Get("relatorio")
  @ApiOperation({ summary: "Relatório Excel do período (?de=AAAA-MM-DD&ate=AAAA-MM-DD): resumo por fila + respostas" })
  async relatorio(@Query("de") de: string, @Query("ate") ate: string, @Res() res: Response) {
    const buf = await this.reengajamento.relatorio(de, ate);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="relatorio-ia-${de || "inicio"}-a-${ate || "hoje"}.xlsx"`);
    res.send(buf);
  }
}

class CorretoresDto {
  @IsArray() @IsString({ each: true }) memberIds: string[];
}
class LigarDto {
  @IsBoolean() ativo: boolean;
}

const GESTORES = [UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE];

/**
 * Fila da Equipe (25/10/2026): leads da planilha do gestor, 1º contato pelo número central
 * (9h–22h, sem check-in) e o "sim" vai em rodízio pros corretores dele. Gestor vê só a dele
 * e escolhe os corretores; só o Diretor liga e desliga.
 */
@ApiTags("Fila da Equipe")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("fila-equipe")
export class FilaEquipeController {
  constructor(private readonly reengajamento: ReengajamentoService) {}

  @Get("minha")
  @Roles(UserRole.DIRETOR, ...GESTORES)
  @ApiOperation({ summary: "Painel da fila da equipe (gestor: a dele; Diretor: ?gestorId=)" })
  minha(@Request() req: any, @Query("gestorId") gestorId?: string) {
    const alvo = req.user.role === UserRole.DIRETOR ? gestorId : req.user.id;
    if (!alvo) throw new ForbiddenException("Escolha o gestor.");
    return this.reengajamento.painelEquipe(alvo);
  }

  @Put("minha/corretores")
  @Roles(...GESTORES)
  @ApiOperation({ summary: "Gestor escolhe os corretores do rodízio da fila dele" })
  corretores(@Request() req: any, @Body() dto: CorretoresDto) {
    return this.reengajamento.salvarCorretores(req.user.id, dto.memberIds);
  }

  @Get()
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Diretor: todas as filas de gestor" })
  listar() {
    return this.reengajamento.listarFilas();
  }

  @Put(":gestorId/ativo")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Diretor liga/desliga a fila de um gestor" })
  ligar(@Param("gestorId") gestorId: string, @Body() dto: LigarDto) {
    return this.reengajamento.ligarFila(gestorId, dto.ativo);
  }
}
