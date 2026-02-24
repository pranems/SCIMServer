/**
 * EndpointSchema domain model — represents a persisted per-endpoint
 * SCIM schema extension.
 */

/** Persisted endpoint schema record (read from DB) */
export interface EndpointSchemaRecord {
  id: string;
  endpointId: string;
  schemaUrn: string;
  name: string;
  description: string | null;
  resourceTypeId: string | null;
  required: boolean;
  /** JSON array of ScimSchemaAttribute definitions */
  attributes: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new endpoint schema */
export interface EndpointSchemaCreateInput {
  endpointId: string;
  schemaUrn: string;
  name: string;
  description?: string | null;
  resourceTypeId?: string | null;
  required?: boolean;
  attributes: unknown;
}
