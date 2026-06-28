import { Controller, Get, Param, Res, NotFoundException } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";

/**
 * Servir a foto de perfil publicamente (para uso direto em <img src>).
 * Avatares não são dados sensíveis, então este endpoint não exige JWT.
 */
@ApiTags("Usuários")
@Controller("users")
export class UsersAvatarController {
  constructor(private readonly usersService: UsersService) {}

  @Get(":id/avatar")
  @ApiOperation({ summary: "Foto de perfil do usuário (imagem)" })
  async avatar(@Param("id") id: string, @Res() res: Response) {
    const file = await this.usersService.getAvatar(id);
    if (!file) throw new NotFoundException("Sem foto de perfil.");
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(file.buffer);
  }
}
