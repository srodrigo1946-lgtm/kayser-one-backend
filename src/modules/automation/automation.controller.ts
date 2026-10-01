import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AutomationService } from "./automation.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

@ApiTags("Automação")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("automation")
export class AutomationController {
  constructor(private readonly automationService: AutomationService) {}

  @Post("followup/run")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Disparar o follow-up automático manualmente (Diretor)" })
  runFollowup() {
    return this.automationService.runFollowup();
  }

  @Post("chamar-leads")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Diretor manda mensagem pros leads sem contato (aos poucos, máx. 40)" })
  chamarLeads(@Body() body: { leadIds?: string[] }) {
    return this.automationService.chamarLeads(Array.isArray(body?.leadIds) ? body.leadIds.map(String) : undefined);
  }
}
