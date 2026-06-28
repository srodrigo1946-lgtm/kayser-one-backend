import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "./user.entity";
import { UsersController } from "./users.controller";
import { UsersAvatarController } from "./users-avatar.controller";
import { UsersService } from "./users.service";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [TypeOrmModule.forFeature([User]), StorageModule],
  controllers: [UsersController, UsersAvatarController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
