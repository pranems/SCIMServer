import { Injectable } from '@nestjs/common';
import {
  SCIM_LIST_RESPONSE_SCHEMA,
} from '../common/scim-constants';
import { createScimError } from '../common/scim-errors';
import { ScimSchemaRegistry } from './scim-schema-registry';
import type { EndpointConfig } from '../../endpoint/endpoint-config.interface';

/**
 * ScimDiscoveryService — Phase 6: Data-Driven Discovery
 *
 * Centralizes all SCIM discovery endpoint responses (Schemas, ResourceTypes,
 * ServiceProviderConfig) into a single injectable service.
 *
 * Delegates to {@link ScimSchemaRegistry} for the authoritative list of
 * schemas, resource types, and extension URNs. Custom extensions registered
 * via the registry are automatically reflected in discovery responses.
 *
 * @see RFC 7643 §7 (Schemas)
 * @see RFC 7643 §6 (ResourceTypes)
 * @see RFC 7644 §4 (ServiceProviderConfig)
 */
@Injectable()
export class ScimDiscoveryService {
  constructor(private readonly registry: ScimSchemaRegistry) {}

  // ─── Schemas ────────────────────────────────────────────────────────────

  /**
   * Returns the full ListResponse for GET /Schemas.
   * Includes all registered schemas (core + global extensions + endpoint-specific).
   */
  getSchemas(endpointId?: string) {
    const resources = this.registry.getAllSchemas(endpointId);

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /**
   * Returns a single Schema by URN for GET /Schemas/{uri}.
   * Throws a SCIM 404 error if the schema is not found.
   *
   * @param schemaUrn - The schema URN identifier (e.g. urn:ietf:params:scim:schemas:core:2.0:User)
   * @param endpointId - Optional endpoint ID for endpoint-scoped lookups
   * @see RFC 7644 §4 — An HTTP GET to retrieve an individual Schema
   */
  getSchemaByUrn(schemaUrn: string, endpointId?: string) {
    const schema = this.registry.getSchema(schemaUrn, endpointId);
    if (!schema) {
      throw createScimError({
        status: 404,
        detail: `Schema "${schemaUrn}" not found.`,
      });
    }
    return schema;
  }

  // ─── ResourceTypes ──────────────────────────────────────────────────────

  /**
   * Returns the full ListResponse for GET /ResourceTypes.
   * Includes schema extensions registered via the registry (global + endpoint-specific).
   */
  getResourceTypes(endpointId?: string) {
    const resources = this.registry.getAllResourceTypes(endpointId);

    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /**
   * Returns a single ResourceType by id for GET /ResourceTypes/{id}.
   * Throws a SCIM 404 error if the resource type is not found.
   *
   * @param resourceTypeId - The resource type id (e.g. "User", "Group")
   * @param endpointId - Optional endpoint ID for endpoint-scoped lookups
   * @see RFC 7644 §4 — An HTTP GET to retrieve an individual ResourceType
   */
  getResourceTypeById(resourceTypeId: string, endpointId?: string) {
    const rt = this.registry.getResourceType(resourceTypeId, endpointId);
    if (!rt) {
      throw createScimError({
        status: 404,
        detail: `ResourceType "${resourceTypeId}" not found.`,
      });
    }
    return rt;
  }

  // ─── ServiceProviderConfig ──────────────────────────────────────────────

  /**
   * Returns the ServiceProviderConfig for GET /ServiceProviderConfig.
   * Includes meta object per RFC 7644 §4 SHOULD recommendation.
   *
   * When called with an EndpointConfig, dynamically adjusts capability
   * flags (e.g., bulk.supported) based on per-endpoint configuration.
   *
   * @param config - Optional per-endpoint configuration to reflect in SPC
   */
  getServiceProviderConfig(config?: EndpointConfig) {
    return this.registry.getServiceProviderConfig(config);
  }

  // ─── Dynamic schemas[] helper ───────────────────────────────────────────

  /**
   * Build the schemas[] array for a SCIM resource response.
   * Dynamically includes any extension URN whose key is present
   * in the payload object.
   *
   * @param payload - The raw JSONB payload from the database
   * @param coreSchema - The core schema URN (User or Group)
   * @param extensionUrns - Override list; defaults to all registered extensions
   * @param endpointId - If provided, includes endpoint-specific extension URNs
   */
  buildResourceSchemas(
    payload: Record<string, unknown> | undefined,
    coreSchema: string,
    extensionUrns?: readonly string[],
    endpointId?: string,
  ): string[] {
    const urns = extensionUrns ?? this.registry.getExtensionUrns(endpointId);
    const schemas: string[] = [coreSchema];

    if (payload) {
      for (const urn of urns) {
        if (urn in payload) {
          schemas.push(urn);
        }
      }
    }

    return schemas;
  }
}
