import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Goal } from "./goal.entity";
import { Lead } from "../leads/lead.entity";
import { GoalsService } from "./goals.service";
import { GoalsController } from "./goals.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [TypeOrmModule.forFeature([Goal, Lead]), UsersModule],
  providers: [GoalsService],
  controllers: [GoalsController],
  exports: [GoalsService],
})
export class GoalsModule {}
