import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { KanbanService } from "./kanban.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

@ApiTags("Kanban")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("kanban")
export class KanbanController {
  constructor(private readonly kanbanService: KanbanService) {}

  @Get("board")
  @ApiOperation({ summary: "Retorna o board completo com leads por coluna" })
  getBoard(@Request() req: any) {
    return this.kanbanService.getBoard(req.user);
  }

  @Get("columns")
  @ApiOperation({ summary: "Lista as colunas do Kanban" })
  columns() {
    return this.kanbanService.listColumns();
  }

  @Put("move/:leadId")
  @ApiOperation({ summary: "Mover card para outra coluna" })
  moveCard(
    @Param("leadId") leadId: string,
    @Body() body: { status: string; order: number },
    @Request() req: any
  ) {
    return this.kanbanService.moveCard(leadId, body.status, body.order, req.user);
  }

  @Post("columns")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Criar coluna (somente Diretor)" })
  createColumn(@Body() body: { title: string; emoji?: string; color?: string }) {
    return this.kanbanService.createColumn(body);
  }

  @Patch("columns/reorder")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Reordenar colunas (somente Diretor)" })
  reorder(@Body() body: { ids: string[] }) {
    return this.kanbanService.reorder(body?.ids ?? []);
  }

  @Patch("columns/:id")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Editar coluna (somente Diretor)" })
  updateColumn(
    @Param("id") id: string,
    @Body() body: { title?: string; emoji?: string; color?: string }
  ) {
    return this.kanbanService.updateColumn(id, body);
  }

  @Delete("columns/:id")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Remover coluna (somente Diretor)" })
  deleteColumn(@Param("id") id: string) {
    return this.kanbanService.deleteColumn(id);
  }
}
