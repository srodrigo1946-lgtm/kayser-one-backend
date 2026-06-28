import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { UserRole } from "./user.entity";

@ApiTags("Usuários")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Listar usuários da equipe" })
  findAll(@Request() req: any) {
    return this.usersService.findAll(req.user);
  }

  @Put("me")
  @ApiOperation({ summary: "Atualizar o próprio perfil (nome, telefone, foto)" })
  updateSelf(
    @Body() dto: { name?: string; phone?: string; whatsapp?: string; avatar?: string },
    @Request() req: any
  ) {
    return this.usersService.updateSelf(req.user.id, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "Buscar usuário por ID" })
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE)
  @ApiOperation({ summary: "Criar usuário" })
  create(@Body() dto: CreateUserDto, @Request() req: any) {
    return this.usersService.create(dto, req.user);
  }

  @Put(":id")
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL)
  @ApiOperation({ summary: "Atualizar usuário" })
  update(@Param("id") id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Delete(":id")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Desativar usuário" })
  remove(@Param("id") id: string) {
    return this.usersService.deactivate(id);
  }
}
