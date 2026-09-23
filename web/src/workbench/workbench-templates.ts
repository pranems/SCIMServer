import {
  resolveEffectiveResourceShape,
  valueForField,
  type ProfileResourceSchema,
  type ProfileResourceType,
} from '../resources/profile-resource-shape';
import type { WorkbenchHeader } from '../utils/workbench-export';

const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export type WorkbenchTemplateCategory = 'Server' | 'Admin' | 'Endpoint' | 'SCIM resource';
export type WorkbenchTemplateMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface WorkbenchRequestTemplate {
  id: string;
  label: string;
  description: string;
  category: WorkbenchTemplateCategory;
  method: WorkbenchTemplateMethod;
  path: string;
  body?: Record<string, unknown>;
  headers?: WorkbenchHeader[];
}

export interface WorkbenchTemplateResource extends Record<string, unknown> {
  id: string;
  meta?: { version?: string };
}

function currentSuffix(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export function getStaticWorkbenchTemplates(exampleSuffix = currentSuffix()): WorkbenchRequestTemplate[] {
  return [
    {
      id: 'server-health',
      label: 'Server health',
      description: 'Read the public process and dependency health envelope.',
      category: 'Server',
      method: 'GET',
      path: '/scim/health',
    },
    {
      id: 'server-service-provider-config',
      label: 'Server ServiceProviderConfig',
      description: 'Read the server-level SCIM capability document.',
      category: 'Server',
      method: 'GET',
      path: '/scim/ServiceProviderConfig',
    },
    {
      id: 'admin-list-endpoints',
      label: 'List endpoints',
      description: 'List endpoint registrations visible to the admin token.',
      category: 'Admin',
      method: 'GET',
      path: '/scim/admin/endpoints',
    },
    {
      id: 'admin-create-endpoint',
      label: 'Create endpoint',
      description: 'Create an endpoint from the RFC-standard built-in preset.',
      category: 'Admin',
      method: 'POST',
      path: '/scim/admin/endpoints',
      body: {
        name: `workbench-endpoint-${exampleSuffix}`,
        displayName: 'Workbench Endpoint Example',
        profilePreset: 'rfc-standard',
      },
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    },
    {
      id: 'admin-dashboard',
      label: 'Admin dashboard',
      description: 'Read the cross-endpoint administrative dashboard.',
      category: 'Admin',
      method: 'GET',
      path: '/scim/admin/dashboard',
    },
  ];
}

export function buildEndpointWorkbenchTemplates(endpointId: string): WorkbenchRequestTemplate[] {
  if (!endpointId) return [];
  return [
    {
      id: 'endpoint-detail',
      label: 'Endpoint detail',
      description: 'Read the selected endpoint and its complete profile.',
      category: 'Endpoint',
      method: 'GET',
      path: `/scim/admin/endpoints/${endpointId}`,
    },
    {
      id: 'endpoint-overview',
      label: 'Endpoint overview',
      description: 'Read endpoint statistics, configuration, and recent activity.',
      category: 'Endpoint',
      method: 'GET',
      path: `/scim/admin/endpoints/${endpointId}/overview`,
    },
    {
      id: 'endpoint-update-settings',
      label: 'Enable strict schema validation',
      description: 'PATCH one endpoint setting without replacing sibling profile sections.',
      category: 'Endpoint',
      method: 'PATCH',
      path: `/scim/admin/endpoints/${endpointId}`,
      body: {
        profile: {
          settings: {
            StrictSchemaValidation: true,
          },
        },
      },
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    },
    {
      id: 'endpoint-resource-types',
      label: 'Endpoint ResourceTypes',
      description: 'Read the ResourceTypes published by the selected endpoint.',
      category: 'Endpoint',
      method: 'GET',
      path: `/scim/endpoints/${endpointId}/ResourceTypes`,
    },
    {
      id: 'endpoint-schemas',
      label: 'Endpoint Schemas',
      description: 'Read the Schemas published by the selected endpoint.',
      category: 'Endpoint',
      method: 'GET',
      path: `/scim/endpoints/${endpointId}/Schemas`,
    },
  ];
}

function replacementValue(
  field: ReturnType<typeof resolveEffectiveResourceShape>['fields'][number],
  value: unknown,
): { available: true; value: unknown } | { available: false } {
  if (field.multiValued) return { available: false };
  if (field.canonicalValues.length > 0) {
    const next = field.canonicalValues.find((candidate) => candidate !== value);
    return next === undefined ? { available: false } : { available: true, value: next };
  }
  if (field.type === 'boolean' && typeof value === 'boolean') {
    return { available: true, value: !value };
  }
  if ((field.type === 'integer' || field.type === 'decimal') && typeof value === 'number') {
    return { available: true, value: value + (field.type === 'integer' ? 1 : 0.5) };
  }
  if (field.type === 'dateTime' && typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return { available: false };
    return { available: true, value: new Date(timestamp + 60_000).toISOString() };
  }
  if (field.type === 'binary' && typeof value === 'string') {
    return { available: true, value: value === 'V29ya2JlbmNo' ? 'U0NJTQ==' : 'V29ya2JlbmNo' };
  }
  if (field.type === 'reference' && typeof value === 'string') {
    try {
      const url = new URL(value);
      url.searchParams.set('workbench', 'updated');
      return { available: true, value: url.toString() };
    } catch {
      return { available: false };
    }
  }
  if (field.type === 'string' && typeof value === 'string') {
    return { available: true, value: `${value}-updated` };
  }
  return { available: false };
}

export function buildResourceWorkbenchTemplates(args: {
  endpointId: string;
  resourceType: ProfileResourceType;
  schemas: ProfileResourceSchema[];
  existingResource?: WorkbenchTemplateResource;
  exampleSuffix?: string;
}): WorkbenchRequestTemplate[] {
  const shape = resolveEffectiveResourceShape(args.resourceType, args.schemas);
  const exampleSuffix = args.exampleSuffix ?? currentSuffix();
  const createValues = Object.fromEntries(shape.fields.map((field) => {
    if (field.uniqueness === 'none' || typeof field.example !== 'string') {
      return [field.id, field.example];
    }
    if (field.name.toLowerCase() === 'username') {
      return [field.id, `workbench-user-${exampleSuffix}@example.com`];
    }
    return [field.id, `${field.name.replace(/([a-z0-9])([A-Z])/gu, '$1-$2').toLowerCase()}-${exampleSuffix}`];
  }));
  const createBody = Object.fromEntries(Object.entries(shape.exampleResource));
  for (const field of shape.fields) {
    if (field.uniqueness === 'none') continue;
    const value = createValues[field.id];
    if (!field.extension) {
      createBody[field.name] = value;
      continue;
    }
    const extension = (createBody[field.schemaUrn] as Record<string, unknown> | undefined) ?? {};
    createBody[field.schemaUrn] = { ...extension, [field.name]: value };
  }
  const resourcePath = args.resourceType.endpoint
    .split('/')
    .filter(Boolean)
    .join('/');
  const basePath = `/scim/endpoints/${args.endpointId}/${resourcePath}`;
  const templates: WorkbenchRequestTemplate[] = [
    {
      id: `resource-${args.resourceType.id}-create`,
      label: `Create ${args.resourceType.name}`,
      description: `POST a profile-valid ${args.resourceType.name} example.`,
      category: 'SCIM resource',
      method: 'POST',
      path: basePath,
      body: createBody,
    },
  ];

  const existing = args.existingResource;
  if (!existing) return templates;
  const candidate = shape.fields
    .filter((field) => !field.immutable && field.inputKind !== 'json')
    .map((field) => ({
      field,
      replacement: replacementValue(field, valueForField(field, existing)),
    }))
    .find((item) => item.replacement.available);
  if (!candidate || !candidate.replacement.available) return templates;
  const { field, replacement } = candidate;
  const headers = existing.meta?.version
    ? [{ key: 'If-Match', value: existing.meta.version, enabled: true }]
    : undefined;
  templates.push({
    id: `resource-${args.resourceType.id}-patch`,
    label: `Update ${args.resourceType.name}`,
    description: `PATCH ${field.label} on existing resource ${existing.id}.`,
    category: 'SCIM resource',
    method: 'PATCH',
    path: `${basePath}/${encodeURIComponent(existing.id)}`,
    body: {
      schemas: [PATCH_SCHEMA],
      Operations: [{
        op: 'replace',
        path: field.path,
        value: replacement.value,
      }],
    },
    headers,
  });
  return templates;
}