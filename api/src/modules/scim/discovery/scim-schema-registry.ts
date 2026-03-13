import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import {
  SCIM_SERVICE_PROVIDER_CONFIG,
} from './scim-schemas.constants';
import { validateAndExpandProfile } from '../endpoint-profile/endpoint-profile.service';
import { getBuiltInPreset } from '../endpoint-profile/built-in-presets';
import {
  SCIM_SCHEMA_SCHEMA,
  SCIM_RESOURCE_TYPE_SCHEMA,
} from '../common/scim-constants';

// --- Types ---
// Re-exported because many files import them from this module.

/** RFC 7643 S7 Schema attribute definition */
export interface ScimSchemaAttribute {
  name: string;
  type: string;
  multiValued: boolean;
  required: boolean;
  description?: string;
  mutability?: string;
  returned?: string;
  caseExact?: boolean;
  uniqueness?: string;
  referenceTypes?: readonly string[];
  subAttributes?: readonly ScimSchemaAttribute[];
}

/** RFC 7643 S7 Schema definition */
export interface ScimSchemaDefinition {
  schemas?: readonly string[];
  id: string;
  name: string;
  description: string;
  attributes: readonly ScimSchemaAttribute[];
  meta?: {
    resourceType: string;
    location: string;
  };
}

/** RFC 7643 S6 Schema extension on a ResourceType */
export interface SchemaExtensionRef {
  schema: string;
  required: boolean;
}

/** RFC 7643 S6 ResourceType definition */
export interface ScimResourceType {
  schemas?: readonly string[];
  id: string;
  name: string;
  endpoint: string;
  description: string;
  schema: string;
  schemaExtensions: SchemaExtensionRef[];
  meta?: {
    resourceType: string;
    location: string;
  };
}

// --- Registry (Minimal - Phase 14.4) ---

/**
 * ScimSchemaRegistry -- Minimal Runtime Utility
 *
 * After Phase 14, the endpoint cache + context carries the full profile.
 * Discovery endpoints serve from profile directly. This registry now only:
 *
 * 1. Expands a default preset at startup for root-level discovery
 * 2. Provides extension URN lookup for buildResourceSchemas()
 */
@Injectable()
export class ScimSchemaRegistry implements OnModuleInit {
  private readonly logger = new Logger(ScimSchemaRegistry.name);

  private defaultSchemas: ScimSchemaDefinition[] = [];
  private defaultResourceTypes: ScimResourceType[] = [];
  private defaultSpc: Record<string, any> = SCIM_SERVICE_PROVIDER_CONFIG;

  async onModuleInit(): Promise<void> {
    try {
      const preset = getBuiltInPreset('rfc-standard');
      const result = validateAndExpandProfile(preset.profile);
      if (result.profile) {
        this.defaultSchemas = result.profile.schemas.map(s => ({
          ...s,
          schemas: (s as any).schemas ?? [SCIM_SCHEMA_SCHEMA],
          meta: (s as any).meta ?? { resourceType: 'Schema', location: `/Schemas/${s.id}` },
        })) as ScimSchemaDefinition[];
        this.defaultResourceTypes = result.profile.resourceTypes.map(r => ({
          ...r,
          schemas: (r as any).schemas ?? [SCIM_RESOURCE_TYPE_SCHEMA],
          meta: (r as any).meta ?? { resourceType: 'ResourceType', location: `/ResourceTypes/${r.id}` },
        })) as ScimResourceType[];
        this.defaultSpc = {
          ...SCIM_SERVICE_PROVIDER_CONFIG,
          ...result.profile.serviceProviderConfig,
          meta: SCIM_SERVICE_PROVIDER_CONFIG.meta,
          schemas: SCIM_SERVICE_PROVIDER_CONFIG.schemas,
          authenticationSchemes: SCIM_SERVICE_PROVIDER_CONFIG.authenticationSchemes,
        };
      }
      this.logger.debug('ScimSchemaRegistry initialized -- root-level defaults from rfc-standard preset.');
    } catch (err) {
      this.logger.warn(`Failed to expand default preset: ${(err as Error).message}`);
    }
  }

  // --- Root-level discovery (no endpointId) ---

  getAllSchemas(): ScimSchemaDefinition[] {
    return this.defaultSchemas;
  }

  getSchema(schemaUrn: string): ScimSchemaDefinition | undefined {
    return this.defaultSchemas.find(s => s.id === schemaUrn);
  }

  getAllResourceTypes(): ScimResourceType[] {
    return this.defaultResourceTypes;
  }

  getResourceType(resourceTypeId: string): ScimResourceType | undefined {
    return this.defaultResourceTypes.find(r => r.id === resourceTypeId || r.name === resourceTypeId);
  }

  getServiceProviderConfig() {
    return this.defaultSpc;
  }

  getExtensionUrns(): readonly string[] {
    const urns = new Set<string>();
    for (const rt of this.defaultResourceTypes) {
      for (const ext of rt.schemaExtensions) {
        urns.add(ext.schema);
      }
    }
    return [...urns];
  }
}
