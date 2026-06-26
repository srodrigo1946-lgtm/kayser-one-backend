import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "./modules/auth/auth.module";
import { UsersModule } from "./modules/users/users.module";
import { LeadsModule } from "./modules/leads/leads.module";
import { KanbanModule } from "./modules/kanban/kanban.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { AiModule } from "./modules/ai/ai.module";
import { WhatsappModule } from "./modules/whatsapp/whatsapp.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
})
export class AppModule {}
