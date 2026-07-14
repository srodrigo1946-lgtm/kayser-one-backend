import { IsString, IsEmail, IsOptional, IsNumber, IsEnum, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { LeadStatus } from "../lead.entity";

export class CreateLeadDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  whatsapp?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  empreendimento?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  propertyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  origem?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campanha?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cidade?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  renda?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  fgts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  entrada?: number;

  @ApiPropertyOptional({ description: "Valor da venda fechada (base do VGV)." })
  @IsOptional()
  @IsNumber()
  valorVenda?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  observacoes?: string;

  @ApiPropertyOptional({ enum: LeadStatus })
  @IsOptional()
  @IsEnum(LeadStatus)
  status?: LeadStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  responsavelId?: string;
}
