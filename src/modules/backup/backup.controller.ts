import { Controller, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { BackupService } from "./backup.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Backup")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("backup")
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Post("run")
  @ApiOperation({ summary: "Rodar um backup do banco agora (envia para o R2)" })
  run() {
    return this.backup.runBackup();
  }
}
