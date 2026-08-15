import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { ConversationsModule } from "../conversations/conversations.module";
import { LeadQueueModule } from "../lead-queue/lead-queue.module";
import { MetaFormsService } from "./meta-forms.service";
import { MetaFormsController } from "./meta-forms.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), ConversationsModule, LeadQueueModule],
  providers: [MetaFormsService],
  controllers: [MetaFormsController],
})
export class MetaFormsModule {}
