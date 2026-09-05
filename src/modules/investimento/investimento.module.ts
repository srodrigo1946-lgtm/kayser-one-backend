import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdInvestment } from "./ad-investment.entity";
import { AdInvestmentDay } from "./ad-investment-day.entity";
import { InvestimentoService } from "./investimento.service";
import { InvestimentoController } from "./investimento.controller";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [TypeOrmModule.forFeature([AdInvestment, AdInvestmentDay]), SettingsModule],
  providers: [InvestimentoService],
  controllers: [InvestimentoController],
  exports: [InvestimentoService],
})
export class InvestimentoModule {}
