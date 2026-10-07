import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { ReengajamentoService } from "./reengajamento.service";

/** Acompanhamento do reengajamento dos "sem interesse" (só Diretor). */
@ApiTags("Reengajamento")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.DIRETOR)
@Controller("reengajamento")
export class ReengajamentoController {
  constructor(private readonly reengajamento: ReengajamentoService) {}

  @Get("painel")
  @ApiOperation({ summary: "Enviados, sim (fila), não (removidos), aguardando e últimas respostas" })
  painel() {
    return this.reengajamento.painel();
  }
}
