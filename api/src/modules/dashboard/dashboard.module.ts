/**
 * DashboardModule - BFF module for the admin dashboard.
 *
 * Phase B1 adds a per-endpoint overview controller method that needs the
 * EndpointCredentialRepository to enumerate credentials. The repository
 * is provided by RepositoryModule.register() which is already imported
 * by ScimModule but not by us; importing it here keeps DashboardModule
 * self-contained for testing in isolation.
 *
 * @see docs/DELIVERY_PLAN.md UI-B6
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase B1
 */
import { Module } from '@nestjs/common';
import { EndpointModule } from '../endpoint/endpoint.module';
import { LoggingModule } from '../logging/logging.module';
import { StatsModule } from '../stats/stats.module';
import { RepositoryModule } from '../../infrastructure/repositories/repository.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [StatsModule, EndpointModule, LoggingModule, RepositoryModule.register()],
  controllers: [DashboardController],
})
export class DashboardModule {}
