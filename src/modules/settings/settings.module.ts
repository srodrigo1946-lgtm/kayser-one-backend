import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Settings } from "./settings.entity";
import { SettingsService } from "./settings.service";
import { SettingsController } from "./settings.controller";
import { MarcaController } from "./marca.controller";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [TypeOrmModule.forFeature([Settings]), StorageModule],
  providers: [SettingsService],
  controllers: [SettingsController, MarcaController],
  exports: [SettingsService],
})
export class SettingsModule {}
