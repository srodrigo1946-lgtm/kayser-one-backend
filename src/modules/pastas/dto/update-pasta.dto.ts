import { PartialType } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";
import { CreatePastaDto } from "./create-pasta.dto";

export class UpdatePastaDto extends PartialType(CreatePastaDto) {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() parecer?: string;
  @IsOptional() @IsString() empresaId?: string;
}
