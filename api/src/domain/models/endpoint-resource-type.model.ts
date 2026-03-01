/**
 * EndpointResourceType domain model — represents a custom SCIM resource type
 * registered for a specific endpoint.
 *
 * Phase 8b: Allows endpoints to register resource types beyond User/Group
 * (e.g., Device, Application). Resources are stored in the polymorphic
 * ScimResource table with the matching resourceType discriminator.
 */

/** Schema extension reference on a resource type */
export interface ResourceTypeSchemaExtension {
  schema: string;
  required: boolean;
}

/** Persisted endpoint resource type record (read from DB) */
export interface EndpointResourceTypeRecord {
  id: string;
  endpointId: string;
  name: string;
  description: string | null;
  schemaUri: string;
  endpoint: string;
  schemaExtensions: ResourceTypeSchemaExtension[];
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating a new endpoint resource type */
export interface EndpointResourceTypeCreateInput {
  endpointId: string;
  name: string;
  description?: string | null;
  schemaUri: string;
  endpoint: string;
  schemaExtensions?: ResourceTypeSchemaExtension[];
}
