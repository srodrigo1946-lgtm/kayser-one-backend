import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
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

  @Get("pending")
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Autocadastros pendentes de aprovação (no seu escopo)" })
  pending(@Request() req: any) {
    return this.usersService.findPending(req.user);
  }

  @Post(":id/approve")
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Aprovar um autocadastro pendente" })
  approve(@Param("id") id: string, @Request() req: any) {
    return this.usersService.approve(id, req.user);
  }

  @Post(":id/reject")
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Recusar (remover) um autocadastro pendente" })
  reject(@Param("id") id: string, @Request() req: any) {
    return this.usersService.reject(id, req.user);
  }

  @Put("me")
  @ApiOperation({ summary: "Atualizar o próprio perfil (nome, telefone, whatsapp)" })
  updateSelf(
    @Body() dto: { name?: string; phone?: string; whatsapp?: string },
    @Request() req: any
  ) {
    return this.usersService.updateSelf(req.user.id, dto);
  }

  @Post("me/avatar")
  @ApiOperation({ summary: "Enviar/atualizar a foto de perfil (arquivo de imagem)" })
  @UseInterceptors(FileInterceptor("file"))
  setAvatar(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    return this.usersService.setAvatar(req.user.id, file);
  }

  @Get("me/ai")
  @ApiOperation({ summary: "Config de IA do próprio usuário (sem expor a chave)" })
  getMyAi(@Request() req: any) {
    return this.usersService.getMyAi(req.user.id);
  }

  @Put("me/ai")
  @ApiOperation({ summary: "Salvar a IA do próprio usuário (provedor/modelo/chave)" })
  updateMyAi(
    @Body() dto: { aiProvider?: string; aiModel?: string; aiApiKey?: string },
    @Request() req: any
  ) {
    return this.usersService.updateMyAi(req.user.id, dto);
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
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Desativar usuário (cada gestor na própria equipe)" })
  remove(@Param("id") id: string, @Request() req: any) {
    return this.usersService.deactivate(id, req.user);
  }

  @Post(":id/activate")
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Reativar usuário (cada gestor na própria equipe)" })
  activate(@Param("id") id: string, @Request() req: any) {
    return this.usersService.activate(id, req.user);
  }

  @Delete(":id/permanent")
  @Roles(UserRole.DIRETOR)
  @ApiOperation({ summary: "Excluir usuário de vez (só Diretor)" })
  hardRemove(@Param("id") id: string, @Request() req: any) {
    return this.usersService.hardRemove(id, req.user);
  }

  @Post(":id/reset-password")
  @Roles(UserRole.DIRETOR, UserRole.SUPERINTENDENTE, UserRole.GERENTE_GERAL, UserRole.GERENTE)
  @ApiOperation({ summary: "Redefinir a senha de um usuário da equipe (volta à padrão + troca forçada)" })
  resetPassword(@Param("id") id: string, @Request() req: any) {
    return this.usersService.resetPassword(id, req.user);
  }
}
