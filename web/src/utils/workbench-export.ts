/**
 * workbench-export - serialise an in-flight Workbench request into
 * formats that Insomnia / Postman / a curl shell / a fetch-call can
 * import directly. The operator's workflow is "compose here, run
 * everywhere": pick the tool, hit Copy, paste into Insomnia /
 * Postman / a runbook / a regression spec.
 *
 * All serialisers take the same `WorkbenchRequestEnvelope` so the
 * caller does not have to reshape per-format. Each returns either a
 * string (curl, fetch, raw-text) or an object (Insomnia v4 export,
 * Postman v2.1 collection) that the caller can JSON.stringify +
 * download / clipboard.
 */

export type WorkbenchHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface WorkbenchHeader {
  key: string;
  value: string;
  /** Disabled headers are preserved for round-trip but not sent. */
  enabled?: boolean;
}

export interface WorkbenchRequestEnvelope {
  /** HTTP method. */
  method: WorkbenchHttpMethod;
  /** Full URL OR path. Insomnia/Postman serialisers prepend `baseUrl` when missing scheme. */
  url: string;
  /** Optional baseUrl prefix used when `url` does not start with http(s)://. */
  baseUrl?: string;
  /** Request body. Strings are sent verbatim; objects are JSON-stringified. */
  body?: unknown;
  /** Headers including the auto-injected Authorization + Content-Type. */
  headers?: WorkbenchHeader[];
  /** Optional human label, used as the request name in collections. */
  name?: string;
}

function activeHeaders(env: WorkbenchRequestEnvelope): WorkbenchHeader[] {
  return (env.headers ?? []).filter(
    (h) => h.enabled !== false && h.key.trim().length > 0,
  );
}

function bodyText(env: WorkbenchRequestEnvelope): string | undefined {
  if (env.body === undefined || env.body === null) return undefined;
  if (typeof env.body === 'string') return env.body;
  try {
    return JSON.stringify(env.body, null, 2);
  } catch {
    return String(env.body);
  }
}

function fullUrl(env: WorkbenchRequestEnvelope): string {
  if (/^https?:\/\//i.test(env.url)) return env.url;
  if (env.baseUrl) {
    // Strip trailing / on baseUrl + leading / on path so we don't
    // produce double-slashes that Postman + Insomnia complain about.
    const base = env.baseUrl.replace(/\/$/, '');
    const path = env.url.startsWith('/') ? env.url : `/${env.url}`;
    return `${base}${path}`;
  }
  return env.url;
}

// ─── curl ─────────────────────────────────────────────────────────────

export function toCurl(env: WorkbenchRequestEnvelope): string {
  const lines: string[] = [`curl -X '${env.method}' \\`];
  lines.push(`  '${fullUrl(env)}' \\`);
  const heads = activeHeaders(env);
  heads.forEach((h, i) => {
    const isLast = i === heads.length - 1 && bodyText(env) === undefined;
    lines.push(`  -H '${h.key}: ${h.value}'${isLast ? '' : ' \\'}`);
  });
  const text = bodyText(env);
  if (text !== undefined) {
    // Escape single quotes for safe POSIX shell embedding.
    const escaped = text.replace(/'/g, `'\\''`);
    lines.push(`  -d '${escaped}'`);
  }
  return lines.join('\n');
}

// ─── fetch / TypeScript ───────────────────────────────────────────────

export function toFetchSnippet(env: WorkbenchRequestEnvelope): string {
  const heads = activeHeaders(env);
  const text = bodyText(env);
  const headersObj: Record<string, string> = {};
  for (const h of heads) headersObj[h.key] = h.value;
  const opts: Record<string, unknown> = {
    method: env.method,
    headers: headersObj,
  };
  if (text !== undefined) opts.body = text;
  return `await fetch(${JSON.stringify(fullUrl(env))}, ${JSON.stringify(opts, null, 2)});`;
}

// ─── Insomnia v4 export ───────────────────────────────────────────────
// https://docs.insomnia.rest/insomnia/import-export-data#export-format
// Minimal subset that Insomnia v9+ accepts via Application > Import.

export interface InsomniaExport {
  _type: 'export';
  __export_format: 4;
  __export_date: string;
  __export_source: string;
  resources: Array<Record<string, unknown>>;
}

export function toInsomnia(env: WorkbenchRequestEnvelope): InsomniaExport {
  const workspaceId = `wrk_scimserver_workbench`;
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const heads = activeHeaders(env);
  const text = bodyText(env);
  return {
    _type: 'export',
    __export_format: 4,
    __export_date: new Date().toISOString(),
    __export_source: 'scimserver-workbench',
    resources: [
      {
        _id: workspaceId,
        _type: 'workspace',
        name: 'SCIMServer Workbench',
        scope: 'collection',
        description: 'Exported from SCIMServer Workbench',
      },
      {
        _id: requestId,
        _type: 'request',
        parentId: workspaceId,
        name: env.name ?? `${env.method} ${env.url}`,
        method: env.method,
        url: fullUrl(env),
        headers: heads.map((h) => ({ name: h.key, value: h.value })),
        body:
          text !== undefined
            ? {
                mimeType: 'application/json',
                text,
              }
            : {},
      },
    ],
  };
}

// ─── Postman Collection v2.1 ─────────────────────────────────────────
// https://schema.getpostman.com/json/collection/v2.1.0/collection.json
// Minimal subset Postman accepts via File > Import.

export interface PostmanCollection {
  info: {
    name: string;
    schema: string;
    _postman_id?: string;
    description?: string;
  };
  item: Array<{
    name: string;
    request: {
      method: WorkbenchHttpMethod;
      header: Array<{ key: string; value: string; type?: 'text' }>;
      body?: { mode: 'raw'; raw: string; options?: { raw: { language: 'json' } } };
      url: {
        raw: string;
        protocol?: string;
        host?: string[];
        path?: string[];
        query?: Array<{ key: string; value: string }>;
      };
    };
  }>;
}

function splitUrl(rawUrl: string): {
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: Array<{ key: string; value: string }>;
} {
  try {
    const u = new URL(rawUrl);
    return {
      protocol: u.protocol.replace(':', ''),
      host: u.hostname.split('.'),
      path: u.pathname.split('/').filter(Boolean),
      query: Array.from(u.searchParams.entries()).map(([k, v]) => ({ key: k, value: v })),
    };
  } catch {
    // Non-absolute URLs (just paths) - Postman tolerates raw-only.
    return {};
  }
}

export function toPostman(env: WorkbenchRequestEnvelope): PostmanCollection {
  const heads = activeHeaders(env);
  const text = bodyText(env);
  const url = fullUrl(env);
  const urlParts = splitUrl(url);
  return {
    info: {
      name: env.name ?? 'SCIMServer Workbench',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: 'Exported from SCIMServer Workbench',
    },
    item: [
      {
        name: env.name ?? `${env.method} ${env.url}`,
        request: {
          method: env.method,
          header: heads.map((h) => ({ key: h.key, value: h.value, type: 'text' })),
          ...(text !== undefined
            ? {
                body: {
                  mode: 'raw' as const,
                  raw: text,
                  options: { raw: { language: 'json' as const } },
                },
              }
            : {}),
          url: {
            raw: url,
            ...urlParts,
          },
        },
      },
    ],
  };
}

// ─── Helpers for the page layer ───────────────────────────────────────

/**
 * Triggers a browser file download with the given filename and JSON
 * content. Returns true if the download initiated (false in
 * server-side rendering contexts where `document` is absent).
 */
export function downloadJson(filename: string, value: unknown): boolean {
  if (typeof document === 'undefined') return false;
  const text =
    typeof value === 'string' ? value : (() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return true;
}

/** Standard SCIM API path suggestions for the path autocomplete datalist. */
export const SCIM_PATH_SUGGESTIONS: ReadonlyArray<string> = [
  '/scim/endpoints/<id>/Users',
  '/scim/endpoints/<id>/Users/<userId>',
  '/scim/endpoints/<id>/Groups',
  '/scim/endpoints/<id>/Groups/<groupId>',
  '/scim/endpoints/<id>/Schemas',
  '/scim/endpoints/<id>/ResourceTypes',
  '/scim/endpoints/<id>/ServiceProviderConfig',
  '/scim/endpoints/<id>/Bulk',
  '/scim/endpoints/<id>/Me',
  '/scim/endpoints/<id>/.search',
  '/scim/endpoints/<id>/Users/.search',
  '/scim/endpoints/<id>/Groups/.search',
  '/scim/admin/endpoints',
  '/scim/admin/endpoints/<id>',
  '/scim/admin/dashboard',
  '/scim/admin/version',
  '/scim/oauth/token',
];
