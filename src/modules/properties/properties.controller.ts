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
} from "@nestjs/common";
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
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Cadastrar imóvel (gestores)" })
  create(@Body() dto: UpsertPropertyDto) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Editar imóvel (gestores)" })
  update(@Param("id") id: string, @Body() dto: UpsertPropertyDto) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @UseGuards(RolesGuard)
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Remover imóvel (gestores)" })
  remove(@Param("id") id: string) {
    return this.service.remove(id);
  }
}
