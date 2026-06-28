import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { AiController } from "./ai.controller";
import { AiService } from "./ai.service";
import { SettingsModule } from "../settings/settings.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), SettingsModule, KnowledgeModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
