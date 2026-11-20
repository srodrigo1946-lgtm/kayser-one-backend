import { Controller, Get, Param, ParseUUIDPipe, Post, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { DiretorGuard } from "../auth/guards/diretor.guard";
import { BolsaoService } from "./bolsao.service";

@ApiTags("Bolsão")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("bolsao")
export class BolsaoController {
  constructor(private readonly bolsao: BolsaoService) {}

  @Get()
  @ApiOperation({ summary: "Leads no Bolsão (SWAT parados 48h) — todos do K1 veem" })
  lista(@Request() req: any) {
    return this.bolsao.lista(req.user);
  }

  @Post("pegar/:leadId")
  @ApiOperation({ summary: "Pegar um lead do Bolsão (o 1º que clicar leva)" })
  pegar(@Param("leadId", ParseUUIDPipe) leadId: string, @Request() req: any) {
    return this.bolsao.pegar(leadId, req.user);
  }

  @Post("mover-agora")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Roda agora a passagem dos SWAT parados 48h pro Bolsão (Diretor)" })
  moverAgora() {
    return this.bolsao.moverParados().then((movidos) => ({ movidos }));
  }
}
