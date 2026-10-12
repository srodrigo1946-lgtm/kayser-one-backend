import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsNumber, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { ADICIONAIS, ClientesSaasService, PLANOS_SAAS, PLANO_PERSONALIZADO } from "./clientes-saas.service";

class AjustarClienteDto {
  @IsOptional() @IsArray() @IsIn(ADICIONAIS, { each: true })
  adicionais?: string[];

  // Valor mensal negociado (R$); null volta para o preço de tabela.
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000)
  valorMensal?: number | null;
}

class CriarClienteDto {
  @IsString() @MinLength(2) @MaxLength(80)
  empresa: string;

  @IsOptional() @IsString() @MaxLength(30)
  subdominio?: string;

  @IsIn([...Object.keys(PLANOS_SAAS), PLANO_PERSONALIZADO])
  plano: string;

  // Só no plano personalizado (negociado com o CEO).
  @IsOptional() @IsInt() @Min(1) @Max(100000)
  limiteUsuarios?: number;

  @IsOptional() @IsArray() @IsIn(ADICIONAIS, { each: true })
  adicionais?: string[];

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
    return { configurado: this.service.configurado(), faltam: this.service.faltam(), planos: PLANOS_SAAS, personalizado: PLANO_PERSONALIZADO, mercadoPago: this.service.mercadoPagoConfigurado(), clientes: await this.service.listar() };
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

  @Post(":id/cobrar")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Gera a assinatura mensal do cliente no Mercado Pago e manda o link pro Diretor dele" })
  cobrar(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.cobrar(id);
  }

  // Público: o Mercado Pago avisa aqui quando uma assinatura muda (pagou, pausou, cancelou).
  @Post("mercadopago")
  @HttpCode(200)
  @ApiOperation({ summary: "Aviso do Mercado Pago (público; a situação é conferida no Mercado Pago)" })
  avisoMercadoPago(@Body() corpo: any, @Query() query: any) {
    return this.service.avisoMercadoPago(corpo, query);
  }

  @Post(":id/ajustar")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Ajusta um cliente: serviços adicionais (IA, IA One, Meta) e valor mensal negociado" })
  ajustar(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AjustarClienteDto) {
    return this.service.ajustar(id, dto);
  }
}
