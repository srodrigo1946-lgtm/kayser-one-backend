import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";

@Module({
  imports: [TypeOrmModule.forFeature([Lead])],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
