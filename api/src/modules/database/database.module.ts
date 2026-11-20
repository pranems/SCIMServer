import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './database.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EndpointModule } from '../endpoint/endpoint.module';

@Module({
  imports: [PrismaModule, EndpointModule],
  controllers: [DatabaseController],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}