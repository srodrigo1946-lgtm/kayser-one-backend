import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { FeedbackNote } from "./feedback-note.entity";
import { User } from "../users/user.entity";
import { FeedbackService } from "./feedback.service";
import { FeedbackController } from "./feedback.controller";
import { UsersModule } from "../users/users.module";

@Module({
  imports: [TypeOrmModule.forFeature([FeedbackNote, User]), UsersModule],
  providers: [FeedbackService],
  controllers: [FeedbackController],
})
export class FeedbackModule {}
