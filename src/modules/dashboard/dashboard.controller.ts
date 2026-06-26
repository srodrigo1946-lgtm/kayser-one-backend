import { Controller, Get, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { DashboardService } from "./dashboard.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

@ApiTags("Dashboard")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("metrics")
  @ApiOperation({ summary: "Métricas gerais do dashboard" })
  metrics(@Request() req: any) {
    return this.dashboardService.getMetrics(req.user);
  }

  @Get("ranking")
  @ApiOperation({ summary: "Ranking de corretores" })
  ranking(@Request() req: any) {
    return this.dashboardService.getRanking(req.user);
  }

  @Get("chart/monthly")
  @ApiOperation({ summary: "Dados mensais para gráfico" })
  monthlyChart(@Request() req: any) {
    return this.dashboardService.getMonthlyData(req.user);
  }

  @Get("alerts")
  @ApiOperation({ summary: "Alertas: leads sem atendimento, clientes sem contato" })
  alerts(@Request() req: any) {
    return this.dashboardService.getAlerts(req.user);
  }
}
