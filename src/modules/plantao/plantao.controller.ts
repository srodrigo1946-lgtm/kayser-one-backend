import { Body, Controller, Get, Param, Post, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsNumber, IsOptional, IsString } from "class-validator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";
import { PlantaoService } from "./plantao.service";

class LocalizacaoDto {
  @Type(() => Number) @IsNumber()
  lat: number;

  @Type(() => Number) @IsNumber()
  lng: number;

  @IsOptional() @Type(() => Number) @IsNumber()
  precisao?: number;
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
  @ApiOperation({ summary: "Check-in no plantão pela localização do celular (até 200 m do stand)" })
  checkin(@Body() dto: LocalizacaoDto, @Request() req: any) {
    return this.plantao.checkin(req.user, dto.lat, dto.lng, dto.precisao);
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
  definir(@Param("propertyId") propertyId: string, @Body() dto: LocalizacaoDto) {
    return this.plantao.definirLocalizacao(propertyId, dto.lat, dto.lng);
  }
}
