import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Property } from "./property.entity";
import { PropertiesService } from "./properties.service";
import { PropertiesController } from "./properties.controller";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [TypeOrmModule.forFeature([Property]), StorageModule],
  providers: [PropertiesService],
  controllers: [PropertiesController],
  exports: [PropertiesService],
})
export class PropertiesModule {}
