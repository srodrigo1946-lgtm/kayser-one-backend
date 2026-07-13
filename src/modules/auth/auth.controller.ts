import { Controller, Post, Body, Get, Query, UseGuards, Request, Put } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { IsEmail, IsString, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { RegisterDto } from "./dto/register.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { UserRole } from "../users/user.entity";

class RecoveryCodeDto {
  @IsString() @MinLength(6)
  recoveryCode: string;
}

class RecoverDto {
  @IsEmail()
  email: string;

  @IsString() @MinLength(6)
  recoveryCode: string;

  @IsString() @MinLength(6)
  newPassword: string;
}

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Rate-limit rígido no login e no autocadastro: 10 tentativas por minuto por IP.
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("login")
  @ApiOperation({ summary: "Login com e-mail e senha" })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("register")
  @ApiOperation({ summary: "Autocadastro escolhendo cargo e gestor do nível acima" })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Get("managers")
  @ApiOperation({ summary: "Lista os gestores (nível acima) para um cargo em autocadastro" })
  managers(@Query("role") role: UserRole) {
    return this.authService.listManagers(role);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Dados do usuário autenticado" })
  me(@Request() req: any) {
    // Nunca expõe passwordHash / aiApiKey / recoveryCodeHash ao front — só o booleano.
    return { ...this.authService.sanitize(req.user), hasRecoveryCode: !!req.user.recoveryCodeHash };
  }

  @Put("recovery-code")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Diretor define/atualiza o código de recuperação" })
  setRecoveryCode(@Body() dto: RecoveryCodeDto, @Request() req: any) {
    return this.authService.setRecoveryCode(req.user.id, dto.recoveryCode);
  }

  // Recuperação self-service do Diretor: rate-limit rígido (5/min por IP).
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post("recover")
  @ApiOperation({ summary: "Diretor recupera a senha com e-mail + código de recuperação" })
  recover(@Body() dto: RecoverDto) {
    return this.authService.recover(dto);
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
