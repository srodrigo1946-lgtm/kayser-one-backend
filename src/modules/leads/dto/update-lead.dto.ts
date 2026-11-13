import { PartialType } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { CreateLeadDto } from "./create-lead.dto";

export class UpdateLeadDto extends PartialType(CreateLeadDto) {
  // Motivo de "sem interesse" (obrigatório ao marcar venda_perdida — 13/11).
  @IsOptional() @IsString() @MaxLength(500)
  perdaMotivo?: string;
}
