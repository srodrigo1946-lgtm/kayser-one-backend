import { Controller, Get, Put, Param, Body, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsString } from "class-validator";
import { EscalaService } from "./escala.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

class SetAtendentesDto {
  @IsArray()
  @IsString({ each: true })
  atendenteIds: string[];
}

@ApiTags("Escala de Atendimento")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("escala")
export class EscalaController {
  constructor(private readonly escala: EscalaService) {}

  @Get()
  @ApiOperation({ summary: "Grade semanal da escala (todos os cargos veem)" })
  grade() {
    return this.escala.getGrade();
  }

  @Put(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Definir atendentes de um turno (somente Diretor)" })
  setAtendentes(@Param("id") id: string, @Body() dto: SetAtendentesDto) {
    return this.escala.setAtendentes(id, dto.atendenteIds);
  }
}
