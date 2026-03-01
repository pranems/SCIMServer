import { Module } from '@nestjs/common';
import { WebController } from './web.controller';
import { HealthController } from '../health/health.controller';

@Module({
  controllers: [WebController, HealthController],
})
export class WebModule {}