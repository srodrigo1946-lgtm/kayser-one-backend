import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Property } from "./property.entity";
import { PropertiesService } from "./properties.service";
import { PropertiesController } from "./properties.controller";

@Module({
  imports: [TypeOrmModule.forFeature([Property])],
  providers: [PropertiesService],
  controllers: [PropertiesController],
  exports: [PropertiesService],
})
export class PropertiesModule {}
