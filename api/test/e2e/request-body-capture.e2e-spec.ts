import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { waitForLogRowByRequestId } from './helpers/log-wait.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint, scimBasePath } from './helpers/request.helper';

/**
 * Request body capture on PRE-PARSE failures (Tier 1 marker + Tier 2 raw capture).
 *
 * A request that fails before its body is parsed into `request.body` still
 * persists a RequestLog row (the exception filters run), and its stored
 * `requestBody` is now never silently empty:
 *   - malformed JSON -> a `_bodyNotCaptured` marker with reason `unparseable`
 *     plus the raw bytes (captured by the parser `verify` hook);
 *   - wrong content-type (415) -> a `_bodyNotCaptured` marker with reason
 *     `content-type-rejected` naming the content-type + length.
 */
describe('Request body capture on pre-parse failures (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
    endpointId = await createEndpoint(app, token);
    basePath = scimBasePath(endpointId);
  });

  afterAll(async () => {
    await app.close();
  });

  async function detailForRequestId(requestId: string): Promise<Record<string, unknown> | undefined> {
    // The RequestLog row is buffered and flushed asynchronously, so it is not
    // queryable the instant the response returns. Poll (forcing a flush each
    // attempt) rather than sleeping a fixed interval and hoping.
    const row = await waitForLogRowByRequestId(app, token, requestId);
    if (!row) return undefined;
    const detail = await request(app.getHttpServer())
      .get(`/scim/admin/logs/${row.id as string}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return detail.body as Record<string, unknown>;
  }

  it('malformed JSON -> row stored with an unparseable marker carrying the raw bytes', async () => {
    const res = await request(app.getHttpServer())
      .post(`${basePath}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send('{ "userName": "broken-body-marker", ');
    expect(res.status).toBe(400);
    const rid = res.headers['x-request-id'];
    expect(rid).toBeDefined();

    const detail = await detailForRequestId(rid);
    expect(detail).toBeDefined();
    const body = detail!.requestBody as Record<string, unknown>;
    expect(body._bodyNotCaptured).toBe(true);
    expect(body.reason).toBe('unparseable');
    expect(String(body._rawPreview)).toContain('broken-body-marker');
  });

  it('wrong content-type (415) -> row stored with a content-type-rejected marker', async () => {
    const res = await request(app.getHttpServer())
      .post(`${basePath}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('userName=wrongtype-marker@example.com');
    expect(res.status).toBe(415);
    const rid = res.headers['x-request-id'];
    expect(rid).toBeDefined();

    const detail = await detailForRequestId(rid);
    expect(detail).toBeDefined();
    const body = detail!.requestBody as Record<string, unknown>;
    expect(body._bodyNotCaptured).toBe(true);
    expect(body.reason).toBe('content-type-rejected');
    expect(body.contentType).toContain('text/plain');
    // The raw preview is NOT captured for a skipped parser (no verify hook fired).
    expect(body._rawPreview).toBeUndefined();
  });

  it('a valid request still stores its real parsed body (no marker)', async () => {
    const res = await request(app.getHttpServer())
      .post(`${basePath}/Users`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/scim+json')
      .send({ schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: `ok-body-${Date.now()}@example.com` });
    expect(res.status).toBe(201);
    const rid = res.headers['x-request-id'];
    const detail = await detailForRequestId(rid);
    expect(detail).toBeDefined();
    const body = detail!.requestBody as Record<string, unknown>;
    expect(body._bodyNotCaptured).toBeUndefined();
    expect(String(body.userName)).toContain('ok-body-');
  });
});
