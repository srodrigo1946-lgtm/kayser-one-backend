import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiTags, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { EmpresasService } from "./empresas.service";
import { Empresa } from "./empresa.entity";

@ApiTags("Empresas")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("empresas")
export class EmpresasController {
  constructor(private readonly service: EmpresasService) {}

  @Get()
  @ApiOperation({ summary: "Lista empresas parceiras (Diretor vê todas; demais só aprovadas)" })
  list(@Request() req: any) {
    return this.service.list(req.user);
  }

  @Post()
  @ApiOperation({ summary: "Cadastra empresa parceira (nasce pendente)" })
  create(@Request() req: any, @Body() body: Partial<Empresa>) {
    return this.service.create(body, req.user);
  }

  @Put(":id/status")
  @ApiOperation({ summary: "Aprova/reprova empresa (só Diretor)" })
  setStatus(@Request() req: any, @Param("id") id: string, @Body("status") status: string) {
    return this.service.setStatus(id, status, req.user);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Exclui empresa parceira de vez (só Diretor)" })
  remove(@Request() req: any, @Param("id") id: string) {
    return this.service.remove(id, req.user);
  }
}
