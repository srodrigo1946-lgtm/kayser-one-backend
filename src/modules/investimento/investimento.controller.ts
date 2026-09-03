import { Controller, Get, Put, Query, Body, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsInt, IsNumber, Min, Max } from "class-validator";
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

@ApiTags("Investimento")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("investimento")
export class InvestimentoController {
  constructor(private readonly service: InvestimentoService) {}

  @Get()
  @ApiOperation({ summary: "Investimento do período (mês, ou soma do ano)" })
  get(@Query("year") year: string, @Query("month") month?: string) {
    return this.service.get(Number(year), month ? Number(month) : undefined);
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Definir investimento de um mês (somente Diretor)" })
  set(@Body() dto: SetInvestimentoDto) {
    return this.service.set(dto.ano, dto.mes, dto.valor);
  }
}
