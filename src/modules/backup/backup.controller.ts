import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
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

  @Get("espaco")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Tamanho do banco: tabelas maiores e mídia guardada dentro do banco" })
  espaco() {
    return this.backup.espaco();
  }

  @Post("mover-midia")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Move mídia (data URI) das mensagens pro R2, em lotes" })
  moverMidia(@Query("lote") lote?: string) {
    return this.backup.moverMidia(Number(lote) || 200);
  }

  @Post("compactar/:tabela")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "VACUUM FULL numa tabela (devolve o espaço ao disco)" })
  compactar(@Param("tabela") tabela: string) {
    return this.backup.compactar(tabela);
  }
}
