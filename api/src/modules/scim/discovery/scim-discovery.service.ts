import { Injectable } from '@nestjs/common';
import {
  SCIM_LIST_RESPONSE_SCHEMA,
  SCIM_SCHEMA_SCHEMA,
  SCIM_RESOURCE_TYPE_SCHEMA,
} from '../common/scim-constants';
import { createScimError } from '../common/scim-errors';
import { ScimSchemaRegistry } from './scim-schema-registry';
import { SCIM_SERVICE_PROVIDER_CONFIG } from './scim-schemas.constants';
import type { EndpointProfile } from '../endpoint-profile/endpoint-profile.types';

/**
 * ScimDiscoveryService - Phase 6: Data-Driven Discovery
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

  // ─── Root-level discovery (no endpointId) ───────────────────────────────
  // Used by GET /scim/Schemas, /ResourceTypes, /ServiceProviderConfig (root)

  /** Root-level GET /Schemas - from default rfc-standard preset */
  getSchemas() {
    const resources = this.registry.getAllSchemas();
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /** Root-level GET /Schemas/:uri */
  getSchemaByUrn(schemaUrn: string) {
    const schema = this.registry.getSchema(schemaUrn);
    if (!schema) {
      throw createScimError({ status: 404, detail: `Schema "${schemaUrn}" not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }
    return schema;
  }

  /** Root-level GET /ResourceTypes */
  getResourceTypes() {
    const resources = this.registry.getAllResourceTypes();
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /** Root-level GET /ResourceTypes/:id */
  getResourceTypeById(resourceTypeId: string) {
    const rt = this.registry.getResourceType(resourceTypeId);
    if (!rt) {
      throw createScimError({ status: 404, detail: `ResourceType "${resourceTypeId}" not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }
    return rt;
  }

  /** Root-level GET /ServiceProviderConfig */
  getServiceProviderConfig() {
    return this.registry.getServiceProviderConfig();
  }

  // ─── Profile-based discovery (Phase 14.2) ────────────────────────────

  /** Serve schemas directly from the endpoint's stored profile */
  getSchemasFromProfile(profile?: EndpointProfile) {
    const raw = profile?.schemas ?? [];
    // Ensure each schema has the RFC-required schemas[] and meta fields
    const resources = raw.map(s => ({
      ...s,
      schemas: (s as any).schemas ?? [SCIM_SCHEMA_SCHEMA],
      meta: (s as any).meta ?? { resourceType: 'Schema', location: `/Schemas/${s.id}` },
    }));
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /** Find a single schema by URN from the endpoint's profile */
  getSchemaByUrnFromProfile(schemaUrn: string, profile?: EndpointProfile) {
    const schema = profile?.schemas?.find(s => s.id === schemaUrn);
    if (!schema) {
      throw createScimError({ status: 404, detail: `Schema "${schemaUrn}" not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }
    return {
      ...schema,
      schemas: (schema as any).schemas ?? [SCIM_SCHEMA_SCHEMA],
      meta: (schema as any).meta ?? { resourceType: 'Schema', location: `/Schemas/${schema.id}` },
    };
  }

  /** Serve resource types directly from the endpoint's stored profile */
  getResourceTypesFromProfile(profile?: EndpointProfile) {
    const raw = profile?.resourceTypes ?? [];
    const resources = raw.map(r => ({
      ...r,
      schemas: (r as any).schemas ?? [SCIM_RESOURCE_TYPE_SCHEMA],
      meta: (r as any).meta ?? { resourceType: 'ResourceType', location: `/ResourceTypes/${r.id}` },
    }));
    return {
      schemas: [SCIM_LIST_RESPONSE_SCHEMA],
      totalResults: resources.length,
      startIndex: 1,
      itemsPerPage: resources.length,
      Resources: resources,
    };
  }

  /** Find a single resource type by id from the endpoint's profile */
  getResourceTypeByIdFromProfile(resourceTypeId: string, profile?: EndpointProfile) {
    const rt = profile?.resourceTypes?.find(r => r.id === resourceTypeId || r.name === resourceTypeId);
    if (!rt) {
      throw createScimError({ status: 404, detail: `ResourceType "${resourceTypeId}" not found.`, diagnostics: { errorCode: 'RESOURCE_NOT_FOUND' } });
    }
    return {
      ...rt,
      schemas: (rt as any).schemas ?? [SCIM_RESOURCE_TYPE_SCHEMA],
      meta: (rt as any).meta ?? { resourceType: 'ResourceType', location: `/ResourceTypes/${rt.id}` },
    };
  }

  /** Serve SPC directly from the endpoint's stored profile */
  getSpcFromProfile(profile?: EndpointProfile) {
    if (profile?.serviceProviderConfig) {
      return {
        ...SCIM_SERVICE_PROVIDER_CONFIG,
        ...profile.serviceProviderConfig,
        meta: SCIM_SERVICE_PROVIDER_CONFIG.meta,
        schemas: SCIM_SERVICE_PROVIDER_CONFIG.schemas,
        authenticationSchemes: SCIM_SERVICE_PROVIDER_CONFIG.authenticationSchemes,
      };
    }
    return SCIM_SERVICE_PROVIDER_CONFIG;
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
  ): string[] {
    const urns = extensionUrns ?? this.registry.getExtensionUrns();
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
