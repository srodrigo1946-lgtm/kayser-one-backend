import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ClienteSaas } from "./cliente-saas.entity";
import { ClientesSaasService } from "./clientes-saas.service";
import { ClientesSaasController } from "./clientes-saas.controller";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [TypeOrmModule.forFeature([ClienteSaas]), SettingsModule],
  providers: [ClientesSaasService],
  controllers: [ClientesSaasController],
})
export class ClientesSaasModule {}
