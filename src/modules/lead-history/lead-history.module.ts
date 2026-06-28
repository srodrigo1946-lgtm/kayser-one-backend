import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LeadHistory } from "./lead-history.entity";
import { LeadHistoryService } from "./lead-history.service";

@Module({
  imports: [TypeOrmModule.forFeature([LeadHistory])],
  providers: [LeadHistoryService],
  exports: [LeadHistoryService],
})
export class LeadHistoryModule {}
