import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { KanbanModule } from "./modules/kanban/kanban.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { AiModule } from "./modules/ai/ai.module";
import { WhatsappModule } from "./modules/whatsapp/whatsapp.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { ConversationsModule } from "./modules/conversations/conversations.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { LeadHistoryModule } from "./modules/lead-history/lead-history.module";
import { AutomationModule } from "./modules/automation/automation.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.get("DB_HOST", "localhost"),
        port: config.get<number>("DB_PORT", 5432),
        username: config.get("DB_USER", "postgres"),
        password: config.get("DB_PASS", "postgres"),
        database: config.get("DB_NAME", "kayser_one"),
        entities: [__dirname + "/**/*.entity{.ts,.js}"],
        synchronize: config.get("NODE_ENV") !== "production",
        logging: config.get("NODE_ENV") === "development",
      }),
    }),
    AuthModule,
    UsersModule,
    LeadsModule,
    KanbanModule,
    DashboardModule,
    AiModule,
    WhatsappModule,
    SettingsModule,
    KnowledgeModule,
    ConversationsModule,
    AppointmentsModule,
    LeadHistoryModule,
    AutomationModule,
  ],
})
export class AppModule {}
