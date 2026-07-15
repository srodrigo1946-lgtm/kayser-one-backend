import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SupportService } from "./support.service";
import { UserRole } from "../users/user.entity";

class CreateSupportDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() type?: string;
  @IsString() message: string;
}

@ApiTags("Suporte")
@Controller("support")
export class SupportController {
  constructor(private readonly service: SupportService) {}

  // ---- Público (caixinha da tela de login) ----
  @Post()
  @ApiOperation({ summary: "Enviar mensagem de suporte/reclamação (público)" })
  create(@Body() dto: CreateSupportDto) {
    return this.service.create(dto);
  }

  // ---- Diretor (painel dentro do CRM) ----
  @Get()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Lista as mensagens de suporte (só Diretor)" })
  list(@Request() req: any) {
    this.assertDiretor(req.user);
    return this.service.list();
  }

  @Get("unread/count")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  unread(@Request() req: any) {
    this.assertDiretor(req.user);
    return this.service.unreadCount();
  }

  @Patch(":id/read")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  read(@Request() req: any, @Param("id") id: string) {
    this.assertDiretor(req.user);
    return this.service.markRead(id);
  }

  @Delete(":id")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  remove(@Request() req: any, @Param("id") id: string) {
    this.assertDiretor(req.user);
    return this.service.remove(id);
  }

  private assertDiretor(user: any) {
    if (user?.role !== UserRole.DIRETOR) {
      throw new ForbiddenException("Apenas o Diretor acessa as mensagens de suporte.");
    }
  }
}
