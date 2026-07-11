import { Module } from "@nestjs/common";
import { BackupService } from "./backup.service";
import { BackupController } from "./backup.controller";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [StorageModule],
  providers: [BackupService],
  controllers: [BackupController],
})
export class BackupModule {}
