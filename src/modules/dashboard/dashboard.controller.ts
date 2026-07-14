import { Controller, Get, Query, UseGuards, Request } from "@nestjs/common";
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
  @ApiOperation({ summary: "Dados mensais para gráfico (por ano)" })
  monthlyChart(@Request() req: any, @Query("year") year?: string) {
    return this.dashboardService.getMonthlyData(req.user, year ? Number(year) : undefined);
  }

  @Get("vgv")
  @ApiOperation({ summary: "VGV total do período (ano todo ou mês)" })
  vgv(@Request() req: any, @Query("year") year?: string, @Query("month") month?: string) {
    return this.dashboardService.getPeriodVgv(
      req.user,
      year ? Number(year) : new Date().getFullYear(),
      month ? Number(month) : undefined
    );
  }

  @Get("champion")
  @ApiOperation({ summary: "Campeão por VGV (ano todo ou mês específico)" })
  champion(
    @Request() req: any,
    @Query("year") year?: string,
    @Query("month") month?: string
  ) {
    return this.dashboardService.getChampion(
      req.user,
      year ? Number(year) : new Date().getFullYear(),
      month ? Number(month) : undefined
    );
  }

  @Get("alerts")
  @ApiOperation({ summary: "Alertas: leads sem atendimento, clientes sem contato" })
  alerts(@Request() req: any) {
    return this.dashboardService.getAlerts(req.user);
  }
}
