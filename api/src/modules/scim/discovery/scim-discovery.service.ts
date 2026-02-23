import { Injectable } from '@nestjs/common';
import {
  SCIM_LIST_RESPONSE_SCHEMA,
} from '../common/scim-constants';
import {
  SCIM_USER_SCHEMA_DEFINITION,
  SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION,
  SCIM_GROUP_SCHEMA_DEFINITION,
  SCIM_USER_RESOURCE_TYPE,
  SCIM_GROUP_RESOURCE_TYPE,
  SCIM_SERVICE_PROVIDER_CONFIG,
} from './scim-schemas.constants';

/**
 * ScimDiscoveryService — Phase 6: Data-Driven Discovery
 *
 * Centralizes all SCIM discovery endpoint responses (Schemas, ResourceTypes,
 * ServiceProviderConfig) into a single injectable service, replacing the
 * hardcoded private methods scattered across 4 controllers.
 *
 * Current implementation uses constants; the service interface allows
 * a future migration to database-backed per-endpoint discovery data.
 *
 * @see RFC 7643 §7 (Schemas)
 * @see RFC 7643 §6 (ResourceTypes)
 * @see RFC 7644 §4 (ServiceProviderConfig)
 */
@Injectable()
export class ScimDiscoveryService {
  // ─── Schemas ────────────────────────────────────────────────────────────

  /**
   * Returns the full ListResponse for GET /Schemas.
   * Includes Core User, Enterprise User Extension, and Core Group.
   */
  getSchemas() {
    const resources = [
      SCIM_USER_SCHEMA_DEFINITION,
      SCIM_ENTERPRISE_USER_SCHEMA_DEFINITION,
      SCIM_GROUP_SCHEMA_DEFINITION,
    ];

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  // ─── ResourceTypes ──────────────────────────────────────────────────────

  /**
   * Returns the full ListResponse for GET /ResourceTypes.
   * User includes Enterprise User as a schema extension.
   */
  getResourceTypes() {
    const resources = [
      SCIM_USER_RESOURCE_TYPE,
      SCIM_GROUP_RESOURCE_TYPE,
    ];

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  // ─── ServiceProviderConfig ──────────────────────────────────────────────

  /**
   * Returns the ServiceProviderConfig for GET /ServiceProviderConfig.
   * Includes meta object per RFC 7644 §4 SHOULD recommendation.
   */
  getServiceProviderConfig() {
    return { ...SCIM_SERVICE_PROVIDER_CONFIG };
  }

  // ─── Dynamic schemas[] helper ───────────────────────────────────────────

  /**
   * Build the schemas[] array for a SCIM User resource response.
   * Dynamically includes the Enterprise User extension URN when
   * the payload contains enterprise extension data.
   *
   * Fixes G19: schemas[] now correctly reflects extension data presence.
   *
   * @param payload - The raw JSONB payload from the database
   * @param coreSchema - The core schema URN (User or Group)
   */
  buildResourceSchemas(
    payload: Record<string, unknown> | undefined,
    coreSchema: string,
    extensionUrns: readonly string[] = [],
  ): string[] {
    const schemas: string[] = [coreSchema];

    if (payload) {
      for (const urn of extensionUrns) {
        if (urn in payload) {
          schemas.push(urn);
        }
      }
    }

    return schemas;
  }
}
