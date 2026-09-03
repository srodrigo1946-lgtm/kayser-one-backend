import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdInvestment } from "./ad-investment.entity";
import { InvestimentoService } from "./investimento.service";
import { InvestimentoController } from "./investimento.controller";

@Module({
  imports: [TypeOrmModule.forFeature([AdInvestment])],
  providers: [InvestimentoService],
  controllers: [InvestimentoController],
  exports: [InvestimentoService],
})
export class InvestimentoModule {}
