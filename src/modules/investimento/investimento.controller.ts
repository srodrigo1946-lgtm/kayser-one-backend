import { Controller, Get, Put, Post, Delete, Query, Body, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsInt, IsNumber, Min, Max, IsArray, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { InvestimentoService } from "./investimento.service";
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
  constructor(private readonly service: InvestimentoService) {}

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

  // Entrada automática (FiqOn/Make empurra o gasto do FB). Público, protegido por token.
  @Post("dia-direct")
  @ApiOperation({ summary: "Recebe o gasto de um dia de uma ferramenta parceira (token)" })
  diaDireto(@Query("token") token: string, @Body() body: any) {
    return this.service.setDayDireto(token, body);
  }
}
