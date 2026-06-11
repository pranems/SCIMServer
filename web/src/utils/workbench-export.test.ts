import { describe, it, expect } from 'vitest';
import {
  toCurl,
  toFetchSnippet,
  toInsomnia,
  toPostman,
  downloadJson,
  type WorkbenchRequestEnvelope,
} from './workbench-export';

const baseEnv: WorkbenchRequestEnvelope = {
  method: 'POST',
  url: '/scim/endpoints/ep-1/Users',
  baseUrl: 'https://scimserver-dev.example.com',
  body: { userName: 'alice@example.com' },
  headers: [
    { key: 'Authorization', value: 'Bearer <token>' },
    { key: 'Content-Type', value: 'application/scim+json' },
    { key: 'Disabled-Header', value: 'no', enabled: false },
  ],
  name: 'Create alice',
};

describe('workbench-export', () => {
  describe('toCurl', () => {
    it('emits a multi-line curl command with method, URL, headers, body', () => {
      const out = toCurl(baseEnv);
      expect(out).toMatch(/curl -X 'POST'/);
      expect(out).toContain("'https://scimserver-dev.example.com/scim/endpoints/ep-1/Users'");
      expect(out).toContain("-H 'Authorization: Bearer <token>'");
      expect(out).toContain("-H 'Content-Type: application/scim+json'");
      // Disabled header is omitted
      expect(out).not.toContain('Disabled-Header');
      // Body is included
      expect(out).toMatch(/-d '\{[\s\S]+alice@example\.com[\s\S]+\}'/);
    });

    it('omits the body line for GET', () => {
      const out = toCurl({ ...baseEnv, method: 'GET', body: undefined });
      expect(out).not.toContain('-d ');
    });

    it('honors absolute URLs and skips the baseUrl prefix', () => {
      const out = toCurl({ ...baseEnv, url: 'https://other.host/scim/Users' });
      expect(out).toContain("'https://other.host/scim/Users'");
      expect(out).not.toContain('scimserver-dev.example.com');
    });
  });

  describe('toFetchSnippet', () => {
    it('emits a fetch() call with method, headers, body', () => {
      const out = toFetchSnippet(baseEnv);
      expect(out).toMatch(/^await fetch\(/);
      expect(out).toMatch(/"method":\s*"POST"/);
      expect(out).toMatch(/"Authorization":\s*"Bearer <token>"/);
      expect(out).toMatch(/"body":/);
      expect(out).toContain('alice@example.com');
    });

    it('omits body for GET requests', () => {
      const out = toFetchSnippet({ ...baseEnv, method: 'GET', body: undefined });
      expect(out).not.toMatch(/"body":/);
    });
  });

  describe('toInsomnia', () => {
    it('produces a valid Insomnia v4 export envelope', () => {
      const out = toInsomnia(baseEnv);
      expect(out._type).toBe('export');
      expect(out.__export_format).toBe(4);
      expect(typeof out.__export_date).toBe('string');
      expect(out.resources).toHaveLength(2);
      const workspace = out.resources.find((r) => r._type === 'workspace');
      const request = out.resources.find((r) => r._type === 'request');
      expect(workspace).toBeDefined();
      expect(request).toBeDefined();
      expect((request as { method: string }).method).toBe('POST');
      expect((request as { url: string }).url).toBe(
        'https://scimserver-dev.example.com/scim/endpoints/ep-1/Users',
      );
      const headers = (request as { headers: Array<{ name: string }> }).headers;
      expect(headers.map((h) => h.name)).toEqual(['Authorization', 'Content-Type']);
      const body = (request as { body: { text?: string } }).body;
      expect(body.text).toContain('alice@example.com');
    });
  });

  describe('toPostman', () => {
    it('produces a valid Postman v2.1 collection envelope', () => {
      const out = toPostman(baseEnv);
      expect(out.info.schema).toContain('schema.getpostman.com/json/collection/v2.1.0');
      expect(out.item).toHaveLength(1);
      const item = out.item[0];
      expect(item.request.method).toBe('POST');
      expect(item.request.header.map((h) => h.key)).toEqual(['Authorization', 'Content-Type']);
      expect(item.request.body?.mode).toBe('raw');
      expect(item.request.body?.raw).toContain('alice@example.com');
      expect(item.request.url.raw).toContain('https://scimserver-dev.example.com');
      expect(item.request.url.protocol).toBe('https');
      expect(item.request.url.host).toEqual(['scimserver-dev', 'example', 'com']);
      expect(item.request.url.path).toEqual(['scim', 'endpoints', 'ep-1', 'Users']);
    });

    it('omits body for GET requests', () => {
      const out = toPostman({ ...baseEnv, method: 'GET', body: undefined });
      expect(out.item[0].request.body).toBeUndefined();
    });
  });

  describe('downloadJson', () => {
    it('returns true and would write a file in a real browser', () => {
      // jsdom provides document; this is a smoke test of the helper.
      const ok = downloadJson('test.json', { a: 1 });
      expect(ok).toBe(true);
    });
  });
});
