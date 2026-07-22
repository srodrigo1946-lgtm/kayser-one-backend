import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Min } from "class-validator";
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

  @IsOptional() @IsArray() @IsString({ each: true })
  followupSources?: string[];

  @IsOptional() @IsString()
  followupMsgManha?: string;

  @IsOptional() @IsString()
  followupMsgTarde?: string;

  @IsOptional() @IsString()
  followupMsgNoite?: string;

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

  // Imagem de condições comerciais do mês (aba Grupo Direcional).
  // Trocar = só Diretor. Ver = todos os cargos (JWT via header OU ?token=).
  @Post("direcional-image")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @UseInterceptors(FileInterceptor("file"))
  @ApiOperation({ summary: "Enviar a imagem de condições comerciais (somente Diretor)" })
  setDirecionalImage(@UploadedFile() file: Express.Multer.File) {
    return this.settingsService.setDirecionalImage(file);
  }

  @Get("direcional-image")
  @ApiOperation({ summary: "Servir a imagem de condições comerciais (todos os cargos)" })
  async getDirecionalImage(@Res() res: Response) {
    const img = await this.settingsService.getDirecionalImageData();
    if (!img) {
      res.status(404).send();
      return;
    }
    res.setHeader("Content-Type", img.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(img.buffer);
  }
}
