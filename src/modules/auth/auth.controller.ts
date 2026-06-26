import { Controller, Post, Body, Get, UseGuards, Request, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @ApiOperation({ summary: "Login com e-mail e senha" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Dados do usuário autenticado" })
  me(@Request() req: any) {
    return req.user;
  }

  @Put("change-password")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Alterar senha (obrigatório no primeiro acesso)" })
  changePassword(@Body() dto: ChangePasswordDto, @Request() req: any) {
    return this.authService.changePassword(req.user.id, dto);
  }

  @Post("refresh")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Renovar token" })
  refresh(@Request() req: any) {
    return this.authService.refresh(req.user);
  }
}
