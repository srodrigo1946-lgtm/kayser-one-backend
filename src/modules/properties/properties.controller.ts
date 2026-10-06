import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Res,
  NotFoundException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { PropertiesService } from "./properties.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "../users/user.entity";

class UpsertPropertyDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() construtora?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() vgv?: number;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() standAddress?: string;
  @IsOptional() @IsString() bairro?: string;
  @IsOptional() @IsString() cidade?: string;
  @IsOptional() @IsString() estado?: string;
  @IsOptional() @IsString() cep?: string;
  @IsOptional() @IsNumber() @Min(0) totalUnits?: number;
  @IsOptional() @IsNumber() @Min(0) availableUnits?: number;
  @IsOptional() @IsNumber() priceMin?: number;
  @IsOptional() @IsNumber() priceMax?: number;
  @IsOptional() @IsNumber() areaMin?: number;
  @IsOptional() @IsNumber() areaMax?: number;
  @IsOptional() @IsNumber() bedrooms?: number;
  @IsOptional() @IsNumber() parkingSpots?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @IsOptional() @IsString() deliveryDate?: string;
  @IsOptional() @IsString() imageUrl?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) photos?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags("Imóveis")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("properties")
export class PropertiesController {
  constructor(private readonly service: PropertiesService) {}

  @Get()
  @ApiOperation({ summary: "Listar imóveis (busca por nome/cidade/bairro/construtora)" })
  findAll(@Query("search") search?: string) {
    return this.service.findAll(search);
  }

  @Get(":id")
  @ApiOperation({ summary: "Detalhe do imóvel" })
  findOne(@Param("id") id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Cadastrar imóvel (gestores)" })
  create(@Body() dto: UpsertPropertyDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Editar imóvel (gestores)" })
  update(@Param("id") id: string, @Body() dto: UpsertPropertyDto) {
    return this.service.update(id, dto);
  }

  @Post(":id/book")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 40 * 1024 * 1024 } }))
  @ApiOperation({ summary: "Enviar o book (PDF) do empreendimento (Diretor)" })
  setBook(@Param("id") id: string, @UploadedFile() file: Express.Multer.File) {
    return this.service.setBook(id, file);
  }

  @Get(":id/book")
  @ApiOperation({ summary: "Baixar o book (PDF) do empreendimento" })
  async getBook(@Param("id") id: string, @Res() res: Response) {
    const b = await this.service.getBook(id);
    if (!b) throw new NotFoundException("Este empreendimento não tem book.");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(b.nome)}"`);
    res.send(b.buffer);
  }

  @Delete(":id/book")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Remover o book do empreendimento (Diretor)" })
  removeBook(@Param("id") id: string) {
    return this.service.removeBook(id);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Remover imóvel (gestores)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
