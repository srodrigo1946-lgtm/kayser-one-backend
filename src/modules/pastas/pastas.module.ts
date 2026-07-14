import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Pasta } from "./pasta.entity";
import { Lead } from "../leads/lead.entity";
import { PastasService } from "./pastas.service";
import { PastasController } from "./pastas.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [TypeOrmModule.forFeature([Pasta, Lead]), UsersModule],
  controllers: [PastasController],
  providers: [PastasService],
})
export class PastasModule {}
