import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { KanbanController } from "./kanban.controller";
import { KanbanService } from "./kanban.service";
import { KanbanColumnEntity } from "./kanban-column.entity";
import { LeadsModule } from "../leads/leads.module";

@Module({
  imports: [TypeOrmModule.forFeature([Lead, KanbanColumnEntity]), LeadsModule],
  controllers: [KanbanController],
  providers: [KanbanService],
})
export class KanbanModule {}
