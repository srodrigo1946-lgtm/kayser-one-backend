import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PlantaoCheckin } from "./plantao-checkin.entity";
import { PlantaoBloqueio } from "./plantao-bloqueio.entity";
import { UsersModule } from "../users/users.module";
import { Property } from "../properties/property.entity";
import { User } from "../users/user.entity";
import { EscalaModule } from "../escala/escala.module";
import { SettingsModule } from "../settings/settings.module";
import { PlantaoService } from "./plantao.service";
import { PlantaoController } from "./plantao.controller";

@Module({
  imports: [TypeOrmModule.forFeature([PlantaoCheckin, PlantaoBloqueio, Property, User]), EscalaModule, SettingsModule, UsersModule],
  providers: [PlantaoService],
  controllers: [PlantaoController],
  exports: [PlantaoService],
})
export class PlantaoModule {}
