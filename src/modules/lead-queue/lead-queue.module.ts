import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeadQueueSettings } from "./lead-queue-settings.entity";
import { LeadQueueAssignment } from "./lead-queue-assignment.entity";
import { Conversation } from "../conversations/conversation.entity";
import { User } from "../users/user.entity";
import { LeadQueueService } from "./lead-queue.service";
import { LeadQueueController } from "./lead-queue.controller";

@Module({
  imports: [TypeOrmModule.forFeature([LeadQueueSettings, LeadQueueAssignment, Conversation, User])],
  providers: [LeadQueueService],
  controllers: [LeadQueueController],
  exports: [LeadQueueService],
})
export class LeadQueueModule {}
