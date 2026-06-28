import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Lead } from "../leads/lead.entity";
import { AutomationService } from "./automation.service";
import { AutomationController } from "./automation.controller";
import { SettingsModule } from "../settings/settings.module";
import { WhatsappModule } from "../whatsapp/whatsapp.module";
import { LeadHistoryModule } from "../lead-history/lead-history.module";

@Module({
  imports: [TypeOrmModule.forFeature([Lead]), SettingsModule, WhatsappModule, LeadHistoryModule],
  providers: [AutomationService],
  controllers: [AutomationController],
})
export class AutomationModule {}
