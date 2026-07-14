import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "./lead.entity";
import { Conversation } from "../conversations/conversation.entity";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { LeadHistoryModule } from "../lead-history/lead-history.module";
import { UsersModule } from "../users/users.module";

@Module({
  // Conversation entra aqui só para o repositório (sincronizar o atendente da
  // conversa quando o responsável do lead muda) — sem importar o ConversationsModule,
  // então não há dependência circular.
  imports: [TypeOrmModule.forFeature([Lead, Conversation]), LeadHistoryModule, UsersModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
