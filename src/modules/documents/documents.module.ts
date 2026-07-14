import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DocumentRequest } from "./document-request.entity";
import { Document } from "./document.entity";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";
import { StorageModule } from "../storage/storage.module";
import { UsersModule } from "../users/users.module";
import { Lead } from "../leads/lead.entity";
import { Conversation } from "../conversations/conversation.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentRequest, Document, Lead, Conversation]),
    StorageModule,
    UsersModule,
  ],
  providers: [DocumentsService],
  controllers: [DocumentsController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
