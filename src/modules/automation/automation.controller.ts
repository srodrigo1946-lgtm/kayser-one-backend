import { Controller, Post, UseGuards } from "@nestjs/common";
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
}
