import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BackupService } from "./backup.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

@ApiTags("Backup")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("backup")
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Post("run")
  @Roles(UserRole.DIRETOR) // só Diretor (auditoria 19/10)
  @ApiOperation({ summary: "Rodar um backup do banco agora (envia para o R2)" })
  run() {
    return this.backup.runBackup();
  }
}
