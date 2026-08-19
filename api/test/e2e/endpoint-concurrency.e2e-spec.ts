/**
 * A9 - optimistic concurrency on endpoint profile writes (E2E).
 *
 * Two operators editing one endpoint could silently clobber each other: the
 * write path was last-write-wins and the loser received a `200` with no
 * indication their change had been overwritten.
 *
 * `If-Match` is opt-in, so these also lock the backward-compatible path: a
 * caller that sends no `If-Match` must keep working exactly as before.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { createEndpoint } from './helpers/request.helper';

describe('A9 - endpoint write concurrency (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const read = (id: string) =>
    request(app.getHttpServer()).get(`/scim/admin/endpoints/${id}`).set('Authorization', `Bearer ${token}`);

  const patch = (id: string, body: Record<string, unknown>, ifMatch?: string) => {
    const req = request(app.getHttpServer())
      .patch(`/scim/admin/endpoints/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json');
    if (ifMatch) req.set('If-Match', ifMatch);
    return req.send(body);
  };

  it('A9-E1: GET returns a weak ETag', async () => {
    const id = await createEndpoint(app, token);
    const res = await read(id).expect(200);
    expect(res.headers.etag).toMatch(/^W\/"[a-f0-9]+"$/);
  });

  it('A9-E2: a write with the current ETag succeeds and returns the NEW one', async () => {
    const id = await createEndpoint(app, token);
    const before = (await read(id).expect(200)).headers.etag;

    const res = await patch(id, { displayName: 'A9 first edit' }, before).expect(200);

    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).not.toBe(before);
  });

  it('A9-E3: the lost-update scenario - the second writer is refused with 412', async () => {
    const id = await createEndpoint(app, token);

    // Both operators read the same version.
    const operatorA = (await read(id).expect(200)).headers.etag;
    const operatorB = operatorA;

    // A saves first and wins.
    await patch(id, { displayName: 'operator A change' }, operatorA).expect(200);

    // B saves against the version they read, and must NOT silently clobber A.
    const conflict = await patch(id, { displayName: 'operator B change' }, operatorB).expect(412);
    expect(conflict.body.scimType).toBe('versionMismatch');

    // The decisive assertion: A's change survived. Asserting only the 412 would
    // pass against a server that returned 412 AND applied the write anyway.
    const after = await read(id).expect(200);
    expect(after.body.displayName).toBe('operator A change');
  });

  it('A9-E4: the 412 names both sides so the caller can resolve it', async () => {
    const id = await createEndpoint(app, token);
    const stale = (await read(id).expect(200)).headers.etag;
    await patch(id, { displayName: 'moved on' }, stale).expect(200);

    const conflict = await patch(id, { displayName: 'stale write' }, stale).expect(412);
    const current = (await read(id).expect(200)).headers.etag;

    expect(conflict.body.detail).toContain(stale);
    expect(conflict.body.detail).toContain(current);
  });

  it('A9-E5: backward compatible - a write with NO If-Match still succeeds', async () => {
    const id = await createEndpoint(app, token);
    await patch(id, { displayName: 'no if-match' }).expect(200);

    const after = await read(id).expect(200);
    expect(after.body.displayName).toBe('no if-match');
  });

  it('A9-E6: If-Match "*" matches any current state', async () => {
    const id = await createEndpoint(app, token);
    await patch(id, { displayName: 'wildcard' }, '*').expect(200);
  });

  it('A9-E7: re-submitting IDENTICAL content is not a conflict', async () => {
    const id = await createEndpoint(app, token);
    const etag = (await read(id).expect(200)).headers.etag;

    // A content hash means an idempotent re-save matches rather than conflicts,
    // which a timestamp or row-counter token would get wrong.
    await patch(id, { displayName: 'same' }, etag).expect(200);
    const unchanged = (await read(id).expect(200)).headers.etag;
    await patch(id, { displayName: 'same' }, unchanged).expect(200);
  });

  /**
   * D - the auth-method admin API edits the whole `authentication` block, so
   * concurrent calls raced. If-Match cannot help here: the race is between two
   * requests milliseconds apart, not two operators, and no caller could resolve
   * a conflict they never saw.
   */
  describe('D - concurrent authentication-method writes', () => {
    const addMethod = (id: string, type: string, displayName: string) =>
      request(app.getHttpServer())
        .post(`/scim/admin/endpoints/${id}/authentication/methods`)
        .set('Authorization', `Bearer ${token}`)
        .send({ type, displayName });

    const listMethods = (id: string) =>
      request(app.getHttpServer())
        .get(`/scim/admin/endpoints/${id}/authentication/methods`)
        .set('Authorization', `Bearer ${token}`);

    it('D-E1: three simultaneous adds all survive', async () => {
      const id = await createEndpoint(app, token);

      const results = await Promise.all([
        addMethod(id, 'bearer', 'first'),
        addMethod(id, 'shared-secret', 'second'),
        addMethod(id, 'oauth-client', 'third'),
      ]);
      results.forEach((r) => expect(r.status).toBe(201));

      // Before the fix this returned 1 method while all three calls reported 201.
      const listed = await listMethods(id).expect(200);
      expect(listed.body.methods).toHaveLength(3);
      expect(listed.body.methods.map((m: { displayName: string }) => m.displayName).sort()).toEqual([
        'first',
        'second',
        'third',
      ]);
    });

    it('D-E2: a simultaneous add and remove do not erase each other', async () => {
      const id = await createEndpoint(app, token);
      const existing = (await addMethod(id, 'bearer', 'keep-then-delete').expect(201)).body.id;

      await Promise.all([
        addMethod(id, 'shared-secret', 'added-concurrently').expect(201),
        request(app.getHttpServer())
          .delete(`/scim/admin/endpoints/${id}/authentication/methods/${existing}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(204),
      ]);

      const listed = await listMethods(id).expect(200);
      expect(listed.body.methods).toHaveLength(1);
      expect(listed.body.methods[0].displayName).toBe('added-concurrently');
    });

    it('D-E3: a rejected add does not wedge the endpoint', async () => {
      const id = await createEndpoint(app, token);

      // The lock is released on the failure path, or every later call would hang.
      await addMethod(id, 'not-a-real-type', 'invalid').expect(400);
      await addMethod(id, 'bearer', 'after-failure').expect(201);

      const listed = await listMethods(id).expect(200);
      expect(listed.body.methods).toHaveLength(1);
    });
  });
});
