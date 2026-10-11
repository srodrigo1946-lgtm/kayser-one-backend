import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { ClientesSaasService, PLANOS_SAAS } from "./clientes-saas.service";

class CriarClienteDto {
  @IsString() @MinLength(2) @MaxLength(80)
  empresa: string;

  @IsOptional() @IsString() @MaxLength(30)
  subdominio?: string;

  @IsIn(Object.keys(PLANOS_SAAS))
  plano: string;

  @IsString() @MinLength(2) @MaxLength(80)
  diretorNome: string;

  @IsEmail() @MaxLength(160)
  diretorEmail: string;
}

/** Venda do Kayser One: criar a instalação de uma imobiliária (só o Diretor da Kayser). */
@ApiTags("Clientes (SaaS)")
@Controller("clientes-saas")
export class ClientesSaasController {
  constructor(private readonly service: ClientesSaasService) {}

  // Público: o repassador do Cloudflare pergunta para qual servidor vai cada subdomínio.
  @Get("destino/:sub")
  @ApiOperation({ summary: "Servidor de um subdomínio de cliente (público, usado pelo Cloudflare)" })
  destino(@Param("sub") sub: string) {
    return this.service.destino(sub);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  async listar() {
    return { configurado: this.service.configurado(), planos: PLANOS_SAAS, clientes: await this.service.listar() };
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Criar a instalação de uma imobiliária (Railway + banco + subdomínio + e-mail)" })
  criar(@Body() dto: CriarClienteDto) {
    return this.service.criar(dto);
  }

  @Post(":id/tentar-de-novo")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  tentarDeNovo(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.tentarDeNovo(id);
  }
}
