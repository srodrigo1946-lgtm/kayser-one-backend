import { IsEmail, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({ example: "rodrigo@kayserone.com.br" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "123456789" })
  @IsString()
  @MinLength(6)
  password: string;
}
