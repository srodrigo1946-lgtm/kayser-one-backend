import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SupportMessage } from "./support-message.entity";
import { SupportService } from "./support.service";
import { SupportController } from "./support.controller";

@Module({
  imports: [TypeOrmModule.forFeature([SupportMessage])],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
