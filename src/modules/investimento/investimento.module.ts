import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdInvestment } from "./ad-investment.entity";
import { AdInvestmentDay } from "./ad-investment-day.entity";
import { AnuncioDia } from "./anuncio-dia.entity";
import { InvestimentoService } from "./investimento.service";
import { TathyService } from "./tathy.service";
import { InvestimentoController } from "./investimento.controller";
import { SettingsModule } from "../settings/settings.module";

@Module({
  imports: [TypeOrmModule.forFeature([AdInvestment, AdInvestmentDay, AnuncioDia]), SettingsModule],
  providers: [InvestimentoService, TathyService],
  controllers: [InvestimentoController],
  exports: [InvestimentoService],
})
export class InvestimentoModule {}
