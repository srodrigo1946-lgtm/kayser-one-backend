import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Request, UseGuards } from "@nestjs/common";
import { IsBoolean } from "class-validator";

class BloqueioDto {
  @IsBoolean() bloqueado!: boolean;
}
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

  @Get("bloqueios")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Quem pode pegar no Bolsão: gerentes e corretores com o bloqueio (Diretor)" })
  bloqueios() {
    return this.bolsao.bloqueios();
  }

  @Put("bloqueio/:userId")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Bloquear/liberar alguém (gerente = time todo) de pegar no Bolsão (Diretor)" })
  bloquear(@Param("userId", ParseUUIDPipe) userId: string, @Body() dto: BloqueioDto) {
    return this.bolsao.definirBloqueio(userId, dto.bloqueado);
  }

  @Post("mover-agora")
  @UseGuards(DiretorGuard)
  @ApiOperation({ summary: "Roda agora a passagem dos SWAT parados 48h pro Bolsão (Diretor)" })
  moverAgora() {
    return this.bolsao.moverParados().then((movidos) => ({ movidos }));
  }
}
