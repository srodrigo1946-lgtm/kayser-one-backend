import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { DocumentRequest } from "./document-request.entity";
import { Document } from "./document.entity";
import { DocumentsService } from "./documents.service";
import { DocumentsController } from "./documents.controller";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [TypeOrmModule.forFeature([DocumentRequest, Document]), StorageModule],
  providers: [DocumentsService],
  controllers: [DocumentsController],
})
export class DocumentsModule {}
