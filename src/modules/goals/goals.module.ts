import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Goal } from "./goal.entity";
import { Lead } from "../leads/lead.entity";
import { GoalsService } from "./goals.service";
import { GoalsController } from "./goals.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Goal, Lead])],
  providers: [GoalsService],
  controllers: [GoalsController],
  exports: [GoalsService],
})
export class GoalsModule {}
