import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { KanbanController } from "./kanban.controller";
import { KanbanService } from "./kanban.service";

@Module({
  imports: [TypeOrmModule.forFeature([Lead])],
  controllers: [KanbanController],
  providers: [KanbanService],
})
export class KanbanModule {}
