import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "./lead.entity";
import { LeadsController } from "./leads.controller";
import { LeadsService } from "./leads.service";
import { LeadHistoryModule } from "../lead-history/lead-history.module";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), LeadHistoryModule, UsersModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
