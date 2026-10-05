import { Body, Controller, Delete, Get, Param, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsString, MaxLength } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { SettingsService } from "../settings/settings.service";
import { IaOneService } from "./ia-one.service";

class TestarDto {
  @IsString() @MaxLength(2000)
  mensagem: string;
}

class UnidadesCsvDto {
  @IsString() @MaxLength(5_000_000)
  csv: string;
}

/** Aba IA One (só Diretor): número próprio, chaves, planilhas, teste e conversas. */
@ApiTags("IA One")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DIRETOR)
@Controller("ia-one")
export class IaOneController {
  constructor(
    private readonly one: IaOneService,
    private readonly settings: SettingsService
  ) {}

  @Get("status")
  @ApiOperation({ summary: "Conexão do número da IA One" })
  status() {
    return this.one.status();
  }

  @Post("conectar")
  @ApiOperation({ summary: "Cria/conecta o número da IA One e devolve o QR" })
  conectar(@Query("reset") reset?: string) {
    return this.one.conectar(reset === "1");
  }

  @Delete("instancia")
  @ApiOperation({ summary: "Desconecta o número da IA One" })
  desconectar() {
    return this.one.desconectar();
  }

  @Get("dados")
  @ApiOperation({ summary: "O que a IA One está lendo das planilhas" })
  dados() {
    return this.one.resumoDados();
  }

  @Post("unidades-csv")
  @ApiOperation({ summary: "Sobe a tabela de unidades (CSV exportado do Data Studio)" })
  async unidadesCsv(@Body() dto: UnidadesCsvDto) {
    await this.settings.update({ ioneUnidadesCsv: dto.csv } as any);
    return this.one.resumoDados();
  }

  @Post("testar")
  @ApiOperation({ summary: "Testa a IA One pelo painel (sem WhatsApp)" })
  testar(@Body() dto: TestarDto, @Request() req: any) {
    return this.one.testar(req.user, dto.mensagem);
  }

  @Get("conversas")
  conversas() {
    return this.one.conversas();
  }

  @Get("conversas/:phone")
  mensagens(@Param("phone") phone: string) {
    return this.one.mensagens(phone.replace(/\D/g, ""));
  }
}
