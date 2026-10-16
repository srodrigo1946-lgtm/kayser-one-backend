import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsArray, IsDateString, IsNumber, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SoMatrizGuard } from "../../common/matriz";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { ADICIONAIS, ClientesSaasService, PLANOS_SAAS, PLANO_PERSONALIZADO } from "./clientes-saas.service";

class ComecarDto {
  // id da assinatura que o Mercado Pago devolve na volta do pagamento (preapproval_id).
  @IsString() @MinLength(6) @MaxLength(64)
  assinatura: string;

  @IsString() @MinLength(2) @MaxLength(80)
  empresa: string;

  @IsOptional() @IsString() @MaxLength(30)
  subdominio?: string;

  @IsString() @MinLength(2) @MaxLength(80)
  diretorNome: string;

  @IsEmail() @MaxLength(160)
  diretorEmail: string;
}

class ApagarDto {
  // O endereço do cliente digitado (confirmação de que é esse mesmo).
  @IsString() @MaxLength(40)
  confirmacao: string;
}

class ContaDto {
  @IsIn(["bloquear", "desbloquear", "encerrar", "cancelar_agenda"])
  acao: string;

  // Data marcada (bloquear/encerrar). Vazio ou no passado = agora.
  @IsOptional() @IsDateString()
  quando?: string;
}

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

  // Valor negociado (R$/mês), qualquer valor; vazio = preço de tabela.
  @IsOptional() @IsNumber() @Min(0) @Max(1_000_000)
  valorMensal?: number | null;

  @IsString() @MinLength(2) @MaxLength(80)
  diretorNome: string;

  @IsEmail() @MaxLength(160)
  diretorEmail: string;
}

/** Venda do K1: criar a instalação de uma imobiliária (só o Diretor da Kayser). */
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
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  async listar() {
    return { configurado: this.service.configurado(), faltam: this.service.faltam(), planos: PLANOS_SAAS, personalizado: PLANO_PERSONALIZADO, mercadoPago: this.service.mercadoPagoConfigurado(), clientes: await this.service.listar() };
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Criar a instalação de uma imobiliária (Railway + banco + subdomínio + e-mail)" })
  criar(@Body() dto: CriarClienteDto) {
    return this.service.criar(dto);
  }

  @Post(":id/tentar-de-novo")
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  tentarDeNovo(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.tentarDeNovo(id);
  }

  @Post(":id/cobrar")
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Gera a assinatura mensal do cliente no Mercado Pago e manda o link pro Diretor dele" })
  cobrar(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.cobrar(id);
  }

  // Público: quem acabou de assinar pelo site preenche os dados e o K1 dele é criado.
  @Post("comecar")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: "Comece seu K1 (público; exige assinatura paga no Mercado Pago)" })
  comecar(@Body() dto: ComecarDto) {
    return this.service.comecar(dto);
  }

  @Get("painel")
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Painel do Business K1: clientes, receita, caixa e lucro por mês do ano" })
  painel(@Query("ano") ano?: string) {
    const n = Number(ano);
    return this.service.painel(n >= 2024 && n <= 2100 ? n : new Date().getFullYear());
  }

  @Post(":id/conta")
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Bloquear, desbloquear ou encerrar a conta do cliente (na hora ou numa data)" })
  conta(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ContaDto) {
    return this.service.conta(id, dto.acao, dto.quando);
  }

  @Delete(":id")
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Apaga DE VEZ um cliente encerrado (servidor, banco e cadastro)" })
  apagar(@Param("id", ParseUUIDPipe) id: string, @Body() dto: ApagarDto) {
    return this.service.apagar(id, dto.confirmacao);
  }

  @Post(":id/cobrar-pix")
  @ApiBearerAuth()
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Cobrança avulsa do mês (Pix ou cartão) — link do Mercado Pago pro Diretor do cliente" })
  cobrarPix(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.cobrarPix(id);
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
  @UseGuards(SoMatrizGuard, JwtAuthGuard, RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Ajusta um cliente: serviços adicionais (IA, IA One, Meta) e valor mensal negociado" })
  ajustar(@Param("id", ParseUUIDPipe) id: string, @Body() dto: AjustarClienteDto) {
    return this.service.ajustar(id, dto);
  }
}
