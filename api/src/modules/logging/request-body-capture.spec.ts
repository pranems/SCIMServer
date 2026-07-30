import {
  resolveRequestBodyForLog,
  capStoredBodyString,
  MAX_STORED_BODY_BYTES,
  type BodyNotCapturedMarker,
} from './request-body-capture';
import type { RequestLoggingMeta } from './request-logging.interceptor';

type ReqLike = {
  body?: unknown;
  headers?: Record<string, unknown>;
  rawBody?: Buffer;
};

function req(overrides: ReqLike = {}): any {
  return { body: undefined, headers: {}, ...overrides };
}

describe('resolveRequestBodyForLog', () => {
  it('prefers the interceptor-stashed parsed body (happy path)', () => {
    const meta = { requestBody: { userName: 'a@b.com' } } as unknown as RequestLoggingMeta;
    expect(resolveRequestBodyForLog(req({ body: { other: 1 } }), meta)).toEqual({ userName: 'a@b.com' });
  });

  it('falls back to a non-empty request.body when meta has none', () => {
    expect(resolveRequestBodyForLog(req({ body: { a: 1 } }), undefined)).toEqual({ a: 1 });
  });

  it('marks a malformed body (raw bytes present, unparseable) with a capped preview', () => {
    const raw = Buffer.from('{ "userName": "broken", ', 'utf8');
    const out = resolveRequestBodyForLog(
      req({ body: {}, headers: { 'content-type': 'application/scim+json', 'content-length': '24' }, rawBody: raw }),
      undefined,
    ) as BodyNotCapturedMarker;
    expect(out._bodyNotCaptured).toBe(true);
    expect(out.reason).toBe('unparseable');
    expect(out.contentType).toBe('application/scim+json');
    expect(out._rawPreview).toContain('broken');
  });

  it('parses raw bytes when they are actually valid JSON', () => {
    const raw = Buffer.from('{ "ok": true }', 'utf8');
    const out = resolveRequestBodyForLog(req({ body: {}, headers: { 'content-length': '14' }, rawBody: raw }), undefined);
    expect(out).toEqual({ ok: true });
  });

  it('marks a wrong-content-type body (bytes sent but parser skipped) as content-type-rejected', () => {
    const out = resolveRequestBodyForLog(
      req({ body: {}, headers: { 'content-type': 'text/plain', 'content-length': '30' } }),
      undefined,
    ) as BodyNotCapturedMarker;
    expect(out._bodyNotCaptured).toBe(true);
    expect(out.reason).toBe('content-type-rejected');
    expect(out.contentType).toBe('text/plain');
    expect(out.contentLength).toBe(30);
    expect(out._rawPreview).toBeUndefined();
  });

  it('returns the empty body unchanged for a genuine no-body request', () => {
    expect(resolveRequestBodyForLog(req({ body: {}, headers: {} }), undefined)).toEqual({});
  });

  it('treats an empty stashed body + content-length as a marker (interceptor ran but parser skipped)', () => {
    const meta = { requestBody: {} } as unknown as RequestLoggingMeta;
    const out = resolveRequestBodyForLog(
      req({ body: {}, headers: { 'content-type': 'text/xml', 'content-length': '12' } }),
      meta,
    ) as BodyNotCapturedMarker;
    expect(out.reason).toBe('content-type-rejected');
  });

  it('never throws', () => {
    expect(() => resolveRequestBodyForLog(undefined, undefined)).not.toThrow();
  });
});

describe('capStoredBodyString', () => {
  it('returns short strings unchanged', () => {
    expect(capStoredBodyString('{"a":1}')).toBe('{"a":1}');
  });

  it('returns undefined unchanged', () => {
    expect(capStoredBodyString(undefined)).toBeUndefined();
  });

  it('replaces an over-cap string with a truncation marker', () => {
    const big = 'x'.repeat(MAX_STORED_BODY_BYTES + 100);
    const capped = capStoredBodyString(big);
    const parsed = JSON.parse(capped as string);
    expect(parsed._truncated).toBe(true);
    expect(parsed.originalLength).toBe(MAX_STORED_BODY_BYTES + 100);
    expect(parsed.preview.length).toBe(MAX_STORED_BODY_BYTES);
  });
});
