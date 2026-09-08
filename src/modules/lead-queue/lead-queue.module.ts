import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User } from "../users/user.entity";
import { Lead } from "../leads/lead.entity";
import { LeadQueueService } from "./lead-queue.service";
import { LeadQueueController } from "./lead-queue.controller";
import { EscalaModule } from "../escala/escala.module";
import { ConversationsModule } from "../conversations/conversations.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([LeadQueueSettings, LeadQueueAssignment, Conversation, User, Lead]),
    EscalaModule,
    ConversationsModule,
    forwardRef(() => WhatsappModule),
  ],
  providers: [LeadQueueService],
  controllers: [LeadQueueController],
  exports: [LeadQueueService],
})
export class LeadQueueModule {}
