import { Controller, Get, Put, Body, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
import { SettingsService } from "./settings.service";
import { AiProvider } from "./settings.entity";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

class UpdateSettingsDto {
  @IsOptional() @IsEnum(AiProvider)
  aiProvider?: AiProvider;

  @IsOptional() @IsString()
  aiModel?: string;

  @IsOptional() @IsString()
  aiApiKey?: string;

  @IsOptional() @IsString()
  masterPrompt?: string;

  @IsOptional() @IsBoolean()
  followupEnabled?: boolean;

  @IsOptional() @IsInt() @Min(1)
  followupDays?: number;

  @IsOptional() @IsBoolean()
  aiAutoReply?: boolean;

  @IsOptional() @IsBoolean()
  aiReplyGroups?: boolean;
}

@ApiTags("Configurações")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("settings")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: "Obter configurações (sem expor a chave de IA)" })
  get() {
    return this.settingsService.getPublic();
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Atualizar configurações (somente Diretor)" })
  update(@Body() dto: UpdateSettingsDto) {
    return this.settingsService.update(dto);
  }
}
