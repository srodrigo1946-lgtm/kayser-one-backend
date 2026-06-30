import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Conversation } from "./conversation.entity";
import { Message } from "./message.entity";
import { Lead } from "../leads/lead.entity";
import { ConversationsService } from "./conversations.service";
import { ConversationsController } from "./conversations.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [TypeOrmModule.forFeature([Conversation, Message, Lead]), UsersModule],
  providers: [ConversationsService],
  controllers: [ConversationsController],
  exports: [ConversationsService],
})
export class ConversationsModule {}
