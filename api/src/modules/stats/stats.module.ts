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
 * Phase J (v0.48.1) additions:
 *   - ScimEventSseBridge listens to ALL SCIM_EVENTS via @OnEvent and
 *     forwards onto the SCIM event channel that ScimLogger exposes,
 *     so the SSE log-config stream can broadcast typed mutation events
 *     to the web `useSSE` hook (cross-tab refresh under 100ms instead
 *     of the 30s staleTime fallback).
 *
 * @see docs/DELIVERY_PLAN.md UI-B2
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md
 */
import { Module } from '@nestjs/common';
import { EndpointModule } from '../endpoint/endpoint.module';
import { StatsProjectionService } from './stats-projection.service';
import { NameResolverService } from './name-resolver.service';
import { ScimEventSseBridge } from './scim-event-sse-bridge.service';

@Module({
  imports: [EndpointModule],
  providers: [StatsProjectionService, NameResolverService, ScimEventSseBridge],
  exports: [StatsProjectionService, NameResolverService, ScimEventSseBridge],
})
export class StatsModule {}
