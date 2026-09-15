import { Body, Controller, Get, Param, Post, Put, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString } from "class-validator";
import { CorujaoService } from "./corujao.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DiretorGuard } from "../auth/guards/diretor.guard";

class ConfigDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsString() hora?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsBoolean() incluirDiretor?: boolean;
}

class AtivarDto {
  @IsBoolean() ativo!: boolean;
}

@ApiTags("Corujão")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("corujao")
export class CorujaoController {
  constructor(private readonly corujao: CorujaoService) {}

  @Get("pool")
  @ApiOperation({ summary: "Leads do repique (Diretor ou corretor ativado)" })
  pool(@Request() req: any) {
    return this.corujao.getPool(req.user);
  }

  @Post("aceitar/:leadId")
  @ApiOperation({ summary: "Aceitar a sugestão: o lead vira do corretor e volta pro fluxo" })
  aceitar(@Param("leadId") leadId: string, @Request() req: any) {
    return this.corujao.aceitar(leadId, req.user);
  }

  @Get("config")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Config do Corujão + corretores + estado (somente Diretor)" })
  config() {
    return this.corujao.getConfig();
  }

  @Put("config")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Atualizar config do Corujão (somente Diretor)" })
  setConfig(@Body() dto: ConfigDto) {
    return this.corujao.setConfig(dto);
  }

  @Put("corretor/:id")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Ativar/desativar um corretor no Corujão (somente Diretor)" })
  ativar(@Param("id") id: string, @Body() dto: AtivarDto) {
    return this.corujao.ativarCorretor(id, dto.ativo);
  }

  @Post("puxar")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Puxar o repique e avisar os corretores ativados (somente Diretor)" })
  puxar() {
    return this.corujao.puxarEnviar();
  }
}
