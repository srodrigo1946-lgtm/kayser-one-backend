import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { PlantaoService } from "./plantao.service";

class LocalizacaoDto {
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90)
  lat: number;

  @Type(() => Number) @IsNumber() @Min(-180) @Max(180)
  lng: number;

  @IsOptional() @Type(() => Number) @IsNumber()
  precisao?: number;
}

class TentativaDto {
  @IsString() @MaxLength(300)
  motivo: string;
}

class LiberarDto {
  @IsString()
  userId: string;

  @IsString()
  turnoId: string;
}

@ApiTags("Plantão (check-in)")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("plantao")
export class PlantaoController {
  constructor(private readonly plantao: PlantaoService) {}

  @Get("status")
  @ApiOperation({ summary: "Situação do meu plantão agora (escala + check-in)" })
  status(@Request() req: any) {
    return this.plantao.status(req.user);
  }

  @Post("checkin")
  @ApiOperation({ summary: "Check-in no plantão pela localização do celular (até 1500 m do stand)" })
  checkin(@Body() dto: LocalizacaoDto, @Request() req: any) {
    return this.plantao.checkin(req.user, dto.lat, dto.lng, dto.precisao);
  }

  @Post("tentativa")
  @ApiOperation({ summary: "Registrar falha de check-in do lado do celular (GPS negado/desligado)" })
  tentativa(@Body() dto: TentativaDto, @Request() req: any) {
    return this.plantao.registrarTentativa(req.user, dto.motivo).then(() => ({ ok: true }));
  }

  @Post("tentativa/:id/usar-como-stand")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "A posição de quem tentou vira a do stand (Diretor confirma que ele está lá)" })
  usarComoStand(@Param("id", ParseUUIDPipe) id: string) {
    return this.plantao.usarPosicaoComoStand(id);
  }

  @Post("checkin/:id/usar-como-stand")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "A posição de um check-in vira a do stand (Diretor)" })
  usarCheckinComoStand(@Param("id", ParseUUIDPipe) id: string) {
    return this.plantao.usarCheckinComoStand(id);
  }

  @Get("painel")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Stands e check-ins de hoje (Diretor)" })
  painel() {
    return this.plantao.painel();
  }

  @Post("liberar")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Liberar corretor no plantão sem GPS (Diretor)" })
  liberar(@Body() dto: LiberarDto, @Request() req: any) {
    return this.plantao.liberar(req.user, dto.userId, dto.turnoId);
  }

  @Get("equipe")
  @ApiOperation({ summary: "Corretores que posso bloquear no plantão (Diretor: todos; gestor: equipe)" })
  equipe(@Request() req: any) {
    return this.plantao.equipe(req.user);
  }

  @Post("bloquear/:userId")
  @ApiOperation({ summary: "Bloquear corretor no plantão (hierarquia)" })
  bloquear(@Param("userId", ParseUUIDPipe) userId: string, @Request() req: any) {
    return this.plantao.bloquear(req.user, userId);
  }

  @Post("desbloquear/:userId")
  @ApiOperation({ summary: "Desbloquear corretor no plantão (hierarquia)" })
  desbloquear(@Param("userId", ParseUUIDPipe) userId: string, @Request() req: any) {
    return this.plantao.desbloquear(req.user, userId);
  }

  @Post("localizar-stands")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Localizar no mapa os endereços de stand dos imóveis (Diretor)" })
  localizar() {
    return this.plantao.localizarStands();
  }

  @Post("stand/:propertyId/localizacao")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Diretor no stand grava a localização exata (Diretor)" })
  definir(@Param("propertyId", ParseUUIDPipe) propertyId: string, @Body() dto: LocalizacaoDto) {
    return this.plantao.definirLocalizacao(propertyId, dto.lat, dto.lng);
  }
}
