import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KnowledgeItem } from "./knowledge.entity";
import { KnowledgeChunk } from "./knowledge-chunk.entity";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";
import { EmbeddingService } from "./embedding.service";
import { SettingsModule } from "../settings/settings.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeItem, KnowledgeChunk]), SettingsModule, StorageModule],
  providers: [KnowledgeService, EmbeddingService],
  controllers: [KnowledgeController],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
