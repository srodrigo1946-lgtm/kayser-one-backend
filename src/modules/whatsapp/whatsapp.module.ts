import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { IaOneMensagem } from "./ia-one-mensagem.entity";
import { IaOneService } from "./ia-one.service";
import { IaOneController } from "./ia-one.controller";
import { User } from "../users/user.entity";
import { WhatsappController } from "./whatsapp.controller";
import { WhatsappWebhookController } from "./whatsapp-webhook.controller";
import { WhatsappService } from "./whatsapp.service";
import { WhatsappFlowService } from "./whatsapp-flow.service";
import { ConversationsModule } from "../conversations/conversations.module";
import { SettingsModule } from "../settings/settings.module";
import { AiModule } from "../ai/ai.module";
import { LeadQueueModule } from "../lead-queue/lead-queue.module";
import { UsersModule } from "../users/users.module";
import { KnowledgeModule } from "../knowledge/knowledge.module";
import { PropertiesModule } from "../properties/properties.module";

@Module({
  imports: [TypeOrmModule.forFeature([IaOneMensagem, User]), ConversationsModule, SettingsModule, AiModule, forwardRef(() => LeadQueueModule), UsersModule, KnowledgeModule, PropertiesModule],
  controllers: [WhatsappController, WhatsappWebhookController, IaOneController],
  providers: [WhatsappService, WhatsappFlowService, IaOneService],
  exports: [WhatsappService, WhatsappFlowService],
})
export class WhatsappModule {}
