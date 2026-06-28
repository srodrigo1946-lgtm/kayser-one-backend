import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsInt, IsOptional, IsString } from "class-validator";
import { AppointmentsService } from "./appointments.service";
import { AppointmentStatus, AppointmentType } from "./appointment.entity";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";

class CreateAppointmentDto {
  @IsString() title: string;
  @IsOptional() @IsEnum(AppointmentType) type?: AppointmentType;
  @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
  @IsDateString() scheduledAt: string;
  @IsOptional() @IsInt() durationMin?: number;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() leadId?: string;
  @IsOptional() @IsString() userId?: string;
}

@ApiTags("Agenda")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("appointments")
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  @ApiOperation({ summary: "Listar agendamentos (por hierarquia, com filtro de período)" })
  findAll(@Request() req: any, @Query("from") from?: string, @Query("to") to?: string) {
    return this.appointmentsService.findAll(req.user, from, to);
  }

  @Post()
  @ApiOperation({ summary: "Criar agendamento" })
  create(@Body() dto: CreateAppointmentDto, @Request() req: any) {
    return this.appointmentsService.create({ ...dto, scheduledAt: new Date(dto.scheduledAt) }, req.user);
  }

  @Put(":id")
  @ApiOperation({ summary: "Atualizar agendamento" })
  update(@Param("id") id: string, @Body() dto: Partial<CreateAppointmentDto>) {
    const patch: any = { ...dto };
    if (dto.scheduledAt) patch.scheduledAt = new Date(dto.scheduledAt);
    return this.appointmentsService.update(id, patch);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Remover agendamento" })
  remove(@Param("id") id: string) {
    return this.appointmentsService.remove(id);
  }
}
