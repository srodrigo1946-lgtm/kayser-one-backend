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

  // Cadastro completo (financiamento / Subir Pasta para Análise).
  @ApiPropertyOptional() @IsOptional() @IsString() cpf?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() dataNascimento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() estadoCivil?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cep?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() logradouro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() numero?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() complemento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bairro?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() estado?: string;

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
