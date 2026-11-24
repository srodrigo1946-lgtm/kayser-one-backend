import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { User } from "../users/user.entity";
import { UsersModule } from "../users/users.module";
import { SettingsModule } from "../settings/settings.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { LeadHistoryModule } from "../lead-history/lead-history.module";
import { DiscadorService } from "./discador.service";
import { DiscadorController } from "./discador.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Lead, User]), UsersModule, SettingsModule, ConversationsModule, WhatsappModule, LeadHistoryModule],
  providers: [DiscadorService],
  controllers: [DiscadorController],
})
export class DiscadorModule {}
