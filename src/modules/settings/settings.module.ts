import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Settings } from "./settings.entity";
import { SettingsService } from "./settings.service";
import { SettingsController } from "./settings.controller";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [TypeOrmModule.forFeature([Settings]), StorageModule],
  providers: [SettingsService],
  controllers: [SettingsController],
  exports: [SettingsService],
})
export class SettingsModule {}
