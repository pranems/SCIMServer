import { Module } from '@nestjs/common';
import { ActivityParserService } from './activity-parser.service';
import { ActivityController } from './activity.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { EndpointModule } from '../endpoint/endpoint.module';

@Module({
  imports: [PrismaModule, EndpointModule],
  controllers: [ActivityController],
  providers: [ActivityParserService],
  exports: [ActivityParserService],
})
export class ActivityParserModule {}