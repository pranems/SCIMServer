/**
 * Barrel export for shared type contracts.
 * Import via: import type { DashboardResponse } from '@scim/types';
 */
export type {
  // Resource stats
  ResourceStats,
  GroupMemberStats,
  RequestLogStats,
  EndpointStatsResponse,

  // Endpoint overview
  SchemaSummary,
  ResourceTypeSummary,
  ServiceProviderConfigSummary,
  ProfileSummary,
  EndpointLinks,
  EndpointResponse,
  EndpointListResponse,

  // Version
  VersionServiceInfo,
  VersionMemoryInfo,
  VersionRuntimeInfo,
  VersionAuthInfo,
  VersionStorageInfo,
  VersionInfo,

  // Health
  HealthResponse,

  // Dashboard BFF
  DashboardHealth,
  DashboardEndpoint,
  DashboardActivity,
  DashboardResponse,

  // Presets
  PresetSummary,
  PresetListResponse,
} from './dashboard.types';
