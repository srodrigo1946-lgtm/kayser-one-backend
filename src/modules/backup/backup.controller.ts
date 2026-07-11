import { Controller, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { BackupService } from "./backup.service";

@ApiTags("Backup")
@Controller("backup")
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  // Temporariamente público para o primeiro teste; será protegido depois.
  @Post("run")
  @ApiOperation({ summary: "Rodar um backup do banco agora (envia para o R2)" })
  run() {
    return this.backup.runBackup();
  }
}
