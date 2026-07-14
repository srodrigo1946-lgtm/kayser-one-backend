import { IsString, IsOptional, IsNumber } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreatePastaDto {
  @ApiProperty() @IsString() leadId: string;

  @ApiPropertyOptional() @IsOptional() @IsString() propertyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() empreendimento?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() construtora?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() unidade?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() bloco?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() apartamento?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() valorAvaliacao?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() valorVendaFinal?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() condicoesComerciais?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() observacoes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() fase?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() perfil?: string;
}
