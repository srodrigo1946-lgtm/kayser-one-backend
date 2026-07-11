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
import { GoalsModule } from "./modules/goals/goals.module";
import { PropertiesModule } from "./modules/properties/properties.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { BackupModule } from "./modules/backup/backup.module";
import { LeadQueueModule } from "./modules/lead-queue/lead-queue.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // Em produção (Railway/Render) usa DATABASE_URL + SSL; localmente usa as vars discretas.
        const databaseUrl = config.get<string>("DATABASE_URL");
        // Sem migrations no projeto: o schema é criado por synchronize.
        // Pode ser desligado com DB_SYNC=false quando houver migrations.
        const synchronize = config.get("DB_SYNC", "true") !== "false";
        const common = {
          type: "postgres" as const,
          entities: [__dirname + "/**/*.entity{.ts,.js}"],
          synchronize,
          logging: config.get("NODE_ENV") === "development",
        };
        if (databaseUrl) {
          return { ...common, url: databaseUrl, ssl: { rejectUnauthorized: false } };
        }
        return {
          ...common,
          host: config.get<string>("DB_HOST", "localhost"),
          port: config.get<number>("DB_PORT", 5432),
          username: config.get<string>("DB_USER", "postgres"),
          password: config.get<string>("DB_PASS", "postgres"),
          database: config.get<string>("DB_NAME", "kayser_one"),
        };
      },
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
    GoalsModule,
    PropertiesModule,
    DocumentsModule,
    BackupModule,
    LeadQueueModule,
  ],
})
export class AppModule {}
