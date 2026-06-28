import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsInt, IsOptional, IsString, Min, Max } from "class-validator";
import { GoalsService } from "./goals.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

class UpsertGoalDto {
  @IsString() userId: string;
  @IsInt() @Min(1) @Max(12) month: number;
  @IsInt() year: number;
  @IsOptional() @IsInt() @Min(0) targetSales?: number;
  @IsOptional() @IsInt() @Min(0) targetVisits?: number;
}

@ApiTags("Metas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("goals")
export class GoalsController {
  constructor(private readonly goalsService: GoalsService) {}

  @Get()
  @ApiOperation({ summary: "Listar metas do mês (por hierarquia)" })
  findAll(@Request() req: any, @Query("month") month?: number, @Query("year") year?: number) {
    return this.goalsService.findAll(req.user, month ? +month : undefined, year ? +year : undefined);
  }

  @Get("progress")
  @ApiOperation({ summary: "Progresso das metas (vendas/visitas realizadas)" })
  progress(@Request() req: any, @Query("month") month?: number, @Query("year") year?: number) {
    return this.goalsService.getProgress(req.user, month ? +month : undefined, year ? +year : undefined);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Definir/atualizar meta de um usuário" })
  upsert(@Body() dto: UpsertGoalDto) {
    return this.goalsService.upsert(dto);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Remover meta" })
  remove(@Param("id") id: string) {
    return this.goalsService.remove(id);
  }
}
