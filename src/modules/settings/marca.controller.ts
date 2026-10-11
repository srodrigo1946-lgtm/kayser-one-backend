import { Controller, Get, Res } from "@nestjs/common";
import { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { SettingsService } from "./settings.service";

/**
 * Marca própria (white-label) — PÚBLICA: a tela de login e o app instalável precisam
 * do nome, da cor e do logo antes de alguém entrar. Só devolve isso (nada sensível).
 */
@ApiTags("Marca")
@Controller("marca")
export class MarcaController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "Nome, cor e se tem logo (público)" })
  marca() {
    return this.settings.marca();
  }

  @Get("logo")
  @ApiOperation({ summary: "Logo da marca (público)" })
  async logo(@Res() res: Response) {
    const img = await this.settings.getMarcaLogo();
    if (!img) {
      res.status(404).send();
      return;
    }
    res.setHeader("Content-Type", img.contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(img.buffer);
  }
}
