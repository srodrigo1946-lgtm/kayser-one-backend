import { Module } from "@nestjs/common";
import { WhatsappController } from "./whatsapp.controller";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";
import { WhatsappService } from "./whatsapp.service";
import { WhatsappFlowService } from "./whatsapp-flow.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { SettingsModule } from "../settings/settings.module";
import { AiModule } from "../ai/ai.module";

@Module({
  imports: [ConversationsModule, SettingsModule, AiModule],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, WhatsappFlowService],
  exports: [WhatsappService, WhatsappFlowService],
})
export class WhatsappModule {}
