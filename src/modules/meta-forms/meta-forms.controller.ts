import { Controller, Get, Post, Query, Body, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Response } from "express";
import { MetaFormsService } from "./meta-forms.service";

// Endpoint público (o Meta chama de fora, sem JWT).
@ApiTags("Formulário Meta")
@Controller("meta")
export class MetaFormsController {
  constructor(private readonly meta: MetaFormsService) {}

  @Get("leadgen")
  @ApiOperation({ summary: "Verificação do webhook do Meta (responde o challenge)" })
  async verify(
    @Query("hub.mode") mode: string,
    @Query("hub.verify_token") token: string,
    @Query("hub.challenge") challenge: string,
    @Res() res: Response
  ) {
    const ok = await this.meta.verify(mode, token, challenge);
    if (ok) res.status(200).send(ok);
    else res.status(403).send();
  }

  @Post("leadgen")
  @ApiOperation({ summary: "Evento de lead do formulário Meta" })
  async event(@Body() body: any, @Res() res: Response) {
    // Responde 200 sempre e processa (o Meta reenvia se não receber 200).
    res.status(200).send("EVENT_RECEIVED");
    await this.meta.handleLeadgen(body).catch(() => {});
  }
}
