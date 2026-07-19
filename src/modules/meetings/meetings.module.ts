import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Meeting } from "./meeting.entity";
import { Appointment } from "../appointments/appointment.entity";
import { MeetingsService } from "./meetings.service";
import { MeetingsController } from "./meetings.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [TypeOrmModule.forFeature([Meeting, Appointment]), UsersModule],
  controllers: [MeetingsController],
  providers: [MeetingsService],
})
export class MeetingsModule {}
