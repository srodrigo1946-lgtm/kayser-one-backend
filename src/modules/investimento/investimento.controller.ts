import { Controller, Get, Put, Post, Delete, Query, Body, UseGuards, Res, Request } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsInt, IsNumber, Min, Max, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { InvestimentoService } from "./investimento.service";
import { TathyService } from "./tathy.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

class SetInvestimentoDto {
  @Type(() => Number) @IsInt()
  ano: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(12)
  mes: number;

  @Type(() => Number) @IsNumber() @Min(0)
  valor: number;
}

class DiaValorDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(31)
  dia: number;

  @Type(() => Number) @IsNumber() @Min(0)
  valor: number;
}

class SetDiasDto {
  @Type(() => Number) @IsInt()
  ano: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(12)
  mes: number;

  @IsArray() @ValidateNested({ each: true }) @Type(() => DiaValorDto)
  dias: DiaValorDto[];
}

@ApiTags("Investimento")
@ApiBearerAuth()
@Controller("investimento")
export class InvestimentoController {
  constructor(
    private readonly service: InvestimentoService,
    private readonly tathyService: TathyService
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Investimento do período (mês, ou soma do ano)" })
  get(@Query("year") year: string, @Query("month") month?: string) {
    return this.service.get(Number(year), month ? Number(month) : undefined);
  }

  @Put()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Definir investimento mensal (somente Diretor)" })
  set(@Body() dto: SetInvestimentoDto) {
    return this.service.set(dto.ano, dto.mes, dto.valor);
  }

  @Get("dias")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Gasto por dia do mês" })
  getDias(@Query("year") year: string, @Query("month") month: string) {
    return this.service.getDays(Number(year), Number(month));
  }

  @Put("dias")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Salvar gasto por dia (somente Diretor)" })
  setDias(@Body() dto: SetDiasDto) {
    return this.service.setDays(dto.ano, dto.mes, dto.dias);
  }

  @Delete("dias")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Apagar o gasto por dia do mês — volta ao valor único (Diretor)" })
  limparDias(@Query("year") year: string, @Query("month") month: string) {
    return this.service.clearDays(Number(year), Number(month));
  }

  @Post("sincronizar-meta")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Puxar agora o gasto por dia do Meta (somente Diretor)" })
  sincronizarMeta(@Query("year") year: string, @Query("month") month: string) {
    return this.service.sincronizarMeta(Number(year), Number(month));
  }

  @Get("tathy")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Tathy: painel de tráfego em tempo real — só leads de anúncio (somente Diretor)" })
  tathy(@Query("year") year: string, @Query("month") month: string) {
    return this.tathyService.painel(Number(year), Number(month));
  }

  @Post("tathy/sincronizar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Puxar agora os anúncios do Meta (somente Diretor)" })
  async tathySincronizar(@Query("year") year: string, @Query("month") month: string) {
    try {
      return { linhas: await this.tathyService.sincronizarAnunciosMeta(Number(year), Number(month)) };
    } catch (err: any) {
      return { linhas: 0, erro: err?.response?.data?.error?.message ?? err.message };
    }
  }

  @Get("tathy/script-google")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Script do Google Ads já com a chave, pra colar (somente Diretor)" })
  tathyScriptGoogle() {
    return this.tathyService.scriptGoogle();
  }

  @Get("tathy/conversa")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Histórico da conversa com a Tathy (somente Diretor)" })
  tathyConversa(@Request() req: any) {
    return this.tathyService.conversa(req.user.id);
  }

  @Post("tathy/perguntar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: "Pergunte à Tathy: texto, imagens e links, com os números ao vivo (somente Diretor)" })
  tathyPerguntar(@Request() req: any, @Body() body: any) {
    return this.tathyService.perguntar(req.user.id, body);
  }

  @Delete("tathy/conversa")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Apagar a conversa com a Tathy (somente Diretor)" })
  tathyLimpar(@Request() req: any) {
    return this.tathyService.limparConversa(req.user.id);
  }

  @Post("tathy/relatorio/enviar")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Enviar agora o relatório da Tathy (PDF + planilha) por e-mail (somente Diretor)" })
  enviarRelatorio() {
    return this.tathyService.enviarRelatorio();
  }

  @Get("tathy/relatorio/arquivo")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Baixar a apresentação (pdf) ou a planilha (xlsx) da Tathy (somente Diretor)" })
  async baixarRelatorio(@Query("tipo") tipo: string, @Res() res: Response) {
    const r = await this.tathyService.apresentacao();
    const xlsx = tipo === "xlsx";
    const nome = `${xlsx ? "Ranking-e-numeros" : "Apresentacao-trafego"}-${r.inicio.replace("/", "-")}-a-${r.fim.replace("/", "-")}.${xlsx ? "xlsx" : "pdf"}`;
    res.setHeader("Content-Type", xlsx ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${nome}"`);
    return res.send(Buffer.from(xlsx ? r.planilha : r.pdf));
  }

  // Script colado no Google Ads empurra os anúncios por dia. Público, protegido pelo Verify Token.
  @Post("google-direct")
  @ApiOperation({ summary: "Recebe os anúncios do Google Ads por dia (script da Tathy, token)" })
  googleDireto(@Query("token") token: string, @Body() body: any) {
    return this.tathyService.receberGoogle(token, body);
  }

  // Entrada automática (FiqOn/Make empurra o gasto do FB). Público, protegido por token.
  @Post("dia-direct")
  @ApiOperation({ summary: "Recebe o gasto de um dia de uma ferramenta parceira (token)" })
  diaDireto(@Query("token") token: string, @Body() body: any) {
    return this.service.setDayDireto(token, body);
  }
}
