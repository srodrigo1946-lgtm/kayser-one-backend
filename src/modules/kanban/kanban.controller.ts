import { Controller, Get, Put, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { KanbanService } from "./kanban.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { LeadStatus } from "../leads/lead.entity";

@ApiTags("Kanban")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("kanban")
export class KanbanController {
  constructor(private readonly kanbanService: KanbanService) {}

  @Get("board")
  @ApiOperation({ summary: "Retorna o board completo com leads por coluna" })
  getBoard(@Request() req: any) {
    return this.kanbanService.getBoard(req.user);
  }

  @Put("move/:leadId")
  @ApiOperation({ summary: "Mover card para outra coluna" })
  moveCard(
    @Param("leadId") leadId: string,
    @Body() body: { status: LeadStatus; order: number },
    @Request() req: any
  ) {
    return this.kanbanService.moveCard(leadId, body.status, body.order, req.user);
  }
}
