import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EscalaTurno } from "./escala-turno.entity";
import { EscalaService } from "./escala.service";
import { EscalaController } from "./escala.controller";

@Module({
  imports: [TypeOrmModule.forFeature([EscalaTurno])],
  providers: [EscalaService],
  controllers: [EscalaController],
  exports: [EscalaService],
})
export class EscalaModule {}
