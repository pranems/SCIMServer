/**
 * DashboardModule - BFF module for the admin dashboard.
 *
 * @see docs/DELIVERY_PLAN.md UI-B6
 */
import { Module } from '@nestjs/common';
import { EndpointModule } from '../endpoint/endpoint.module';
import { LoggingModule } from '../logging/logging.module';
import { StatsModule } from '../stats/stats.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [StatsModule, EndpointModule, LoggingModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
