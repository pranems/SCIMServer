import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { randomUUID } from 'node:crypto';
import { EndpointService } from '../../src/modules/endpoint/services/endpoint.service';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPost, scimPatch, scimDelete } from './helpers/request.helper';

function endpointId(response: Response): string {
  const body: unknown = response.body;
  if (typeof body !== 'object' || body === null || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('Expected endpoint ID.');
  }
  return body.id;
}

describe('Conditional endpoint writes', () => {
  let app: INestApplication;
  let token: string;
  const owned: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const id of owned) {
      await scimDelete(app, `/scim/admin/endpoints/${id}`, token).expect(204);
    }
    await app.close();
  });

  async function createFixture(): Promise<{ path: string; etag: string }> {
    const created = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `conditional-endpoint-${randomUUID()}`,
      profilePreset: 'rfc-standard',
    }).expect(201);
    const id = endpointId(created);
    owned.push(id);
    const path = `/scim/admin/endpoints/${id}`;
    const read = await scimGet(app, path, token).expect(200);
    const etag: unknown = read.headers.etag;
    if (typeof etag !== 'string') throw new Error('Expected endpoint ETag.');
    return { path, etag };
  }

  it('commits only one of two different edits using the same token', async () => {
    const fixture = await createFixture();
    const service = app.get(EndpointService);
    const original = service.updateEndpoint.bind(service);
    let arrivals = 0;
    let release: () => void = () => { throw new Error('Barrier not initialized.'); };
    const barrier = new Promise<void>(resolve => { release = resolve; });
    jest.spyOn(service, 'updateEndpoint').mockImplementation(async (...args) => {
      arrivals++;
      if (arrivals === 2) release();
      await barrier;
      return original(...args);
    });
    const responses = await Promise.all([
      scimPatch(app, fixture.path, token, { displayName: 'First editor' }).set('If-Match', fixture.etag),
      scimPatch(app, fixture.path, token, { displayName: 'Second editor' }).set('If-Match', fixture.etag),
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    const winner = responses.find(response => response.status === 200);
    const loser = responses.find(response => response.status === 412);
    expect(winner).toBeDefined();
    expect(loser?.body).toMatchObject({ status: '412', scimType: 'versionMismatch' });
    const current = await scimGet(app, fixture.path, token).expect(200);
    expect(current.body).toEqual(winner?.body);
    expect(current.headers.etag).toEqual(winner?.headers.etag);
  });

  it('keeps unconditional edits and wildcard matching backward compatible', async () => {
    const fixture = await createFixture();
    await scimPatch(app, fixture.path, token, { displayName: 'Unconditional' }).expect(200);
    await scimPatch(app, fixture.path, token, { displayName: 'Wildcard' }).set('If-Match', '*').expect(200);
    const current = await scimGet(app, fixture.path, token).expect(200);
    expect(current.body).toMatchObject({ displayName: 'Wildcard' });
  });

  it('returns a usable state token with summary views without exposing the full profile', async () => {
    const fixture = await createFixture();
    const summary = await scimGet(app, `${fixture.path}?view=summary`, token).expect(200);
    expect(summary.body).not.toHaveProperty('profile');
    expect(summary.body).toHaveProperty('profileSummary');
    const etag: unknown = summary.headers.etag;
    if (typeof etag !== 'string') throw new Error('Expected summary endpoint ETag.');
    expect(etag).toBe(fixture.etag);
    await scimPatch(app, fixture.path, token, { displayName: 'Edited from summary' }).set('If-Match', etag).expect(200);
    await scimPatch(app, fixture.path, token, { displayName: 'Stale summary edit' }).set('If-Match', etag).expect(412);
  });

  it('allows a repeated identical edit with the same content token', async () => {
    const fixture = await createFixture();
    const changed = await scimPatch(app, fixture.path, token, { displayName: 'Same content' }).expect(200);
    const etag: unknown = changed.headers.etag;
    if (typeof etag !== 'string') throw new Error('Expected updated endpoint ETag.');
    await scimPatch(app, fixture.path, token, { displayName: 'Same content' }).set('If-Match', etag).expect(200);
    const repeated = await scimPatch(app, fixture.path, token, { displayName: 'Same content' }).set('If-Match', etag).expect(200);
    expect(repeated.headers.etag).toBe(etag);
  });
});
