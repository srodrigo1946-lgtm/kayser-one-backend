import { Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Put, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DiretorGuard } from "../auth/guards/diretor.guard";
import { ehGestor } from "../kanban/kanban.service";
import { DiscadorService, RESULTADOS, Resultado } from "./discador.service";

class LigadoDto {
  @IsBoolean() ligado!: boolean;
}
class IncluidoDto {
  @IsBoolean() incluido!: boolean;
}
class NumerosDto {
  @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) numeros!: string[];
}
class LigacaoDto {
  @IsUUID() leadId!: string;
  @IsIn(RESULTADOS as unknown as string[]) resultado!: Resultado;
  @IsOptional() @IsInt() @Min(0) duracaoSeg?: number;
  @IsOptional() @IsString() @MaxLength(2000) anotacao?: string;
}
class AnotacaoDto {
  @IsString() @MaxLength(2000) anotacao!: string;
}

const soGestor = (req: any) => {
  if (!ehGestor(req.user)) throw new ForbiddenException("Só gerente pra cima mexe no Discador.");
};

@ApiTags("Discador")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("discador")
export class DiscadorController {
  constructor(private readonly discador: DiscadorService) {}

  @Get()
  @ApiOperation({ summary: "Painel do Discador: liga/desliga, equipe, indicadores de hoje, próximos leads" })
  painel(@Request() req: any) {
    return this.discador.painel(req.user);
  }

  @Put("ligado")
  @ApiOperation({ summary: "Liga/desliga o discador automático (gerente pra cima)" })
  ligado(@Request() req: any, @Body() dto: LigadoDto) {
    soGestor(req);
    return this.discador.definirLigado(dto.ligado);
  }

  @Put("corretor/:id")
  @ApiOperation({ summary: "Incluir/remover corretor do Discador (gestor: só a equipe)" })
  corretor(@Request() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: IncluidoDto) {
    soGestor(req);
    return this.discador.definirCorretor(req.user, id, dto.incluido);
  }

  @Put("numeros")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Os 3 números virtuais (Diretor)" })
  numeros(@Body() dto: NumerosDto) {
    return this.discador.definirNumeros(dto.numeros);
  }

  @Post("ligacoes")
  @ApiOperation({ summary: "Registrar ligação; não atendeu/caixa postal manda WhatsApp" })
  registrar(@Request() req: any, @Body() dto: LigacaoDto) {
    return this.discador.registrar(req.user, dto);
  }

  @Put("ligacoes/:id/anotacao")
  @ApiOperation({ summary: "Escrever/atualizar a anotação da ligação" })
  anotar(@Request() req: any, @Param("id", ParseUUIDPipe) id: string, @Body() dto: AnotacaoDto) {
    return this.discador.anotar(req.user, id, dto.anotacao);
  }
}
