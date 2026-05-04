/**
 * StatsModule - provides in-memory stats projection for the dashboard BFF.
 *
 * Imports:
 *   - EventEmitterModule (for @OnEvent decorator support)
 *   - EndpointModule (for endpoint enumeration during seeding)
 *
 * Repository tokens (USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY)
 * are global - no import needed.
 *
 * @see docs/DELIVERY_PLAN.md UI-B2
 */
import { Module } from '@nestjs/common';
import { EndpointModule } from '../endpoint/endpoint.module';
import { StatsProjectionService } from './stats-projection.service';

@Module({
  imports: [EndpointModule],
  providers: [StatsProjectionService],
  exports: [StatsProjectionService],
})
export class StatsModule {}
