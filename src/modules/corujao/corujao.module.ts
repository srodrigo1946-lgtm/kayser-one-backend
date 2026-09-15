import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CorujaoService } from "./corujao.service";
import { CorujaoController } from "./corujao.controller";
import { Lead } from "../leads/lead.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User } from "../users/user.entity";
import { KanbanColumnEntity } from "../kanban/kanban-column.entity";
import { SettingsModule } from "../settings/settings.module";
import { LeadHistoryModule } from "../lead-history/lead-history.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Lead, Conversation, User, KanbanColumnEntity]),
    SettingsModule,
    LeadHistoryModule,
  ],
  providers: [CorujaoService],
  controllers: [CorujaoController],
})
export class CorujaoModule {}
