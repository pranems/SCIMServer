import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimGet, scimPatch, scimPost, scimDelete } from './helpers/request.helper';

function idFrom(response: Response): string {
  const body: unknown = response.body;
  if (typeof body !== 'object' || body === null || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('Expected endpoint id.');
  }
  return body.id;
}

function endpointsFrom(response: Response): unknown[] {
  const body: unknown = response.body;
  if (typeof body !== 'object' || body === null || !('endpoints' in body) || !Array.isArray(body.endpoints)) {
    throw new Error('Expected endpoint list.');
  }
  return body.endpoints;
}

describe('Endpoint profile visibility across requests', () => {
  let writer: INestApplication;
  let reader: INestApplication;
  let token: string;
  let readerToken: string;
  let endpointId: string;
  let originalName: string;

  beforeAll(async () => {
    writer = await createTestApp();
    token = await getAuthToken(writer);
    originalName = `freshness-${randomUUID()}`;
    const created = await scimPost(writer, '/scim/admin/endpoints', token, {
      name: originalName,
      profilePreset: 'rfc-standard',
    }).expect(201);
    endpointId = idFrom(created);
    reader = process.env.PERSISTENCE_BACKEND === 'prisma'
      ? await createTestApp()
      : writer;
    readerToken = reader === writer ? token : await getAuthToken(reader);
  });

  afterAll(async () => {
    if (reader && reader !== writer) await reader.close();
    if (writer) await writer.close();
  });

  it('observes settings and capability changes after a reader cache is warmed', async () => {
    const url = `/scim/admin/endpoints/${endpointId}`;
    await scimGet(reader, url, readerToken).expect(200);
    await scimPatch(writer, url, token, {
      profile: {
        settings: { StrictSchemaValidation: false },
        serviceProviderConfig: { patch: { supported: false } },
      },
    }).expect(200);
    const refreshed = await scimGet(reader, url, readerToken).expect(200);
    expect(refreshed.body).toMatchObject({
      id: endpointId,
      profile: {
        settings: { StrictSchemaValidation: false },
        serviceProviderConfig: { patch: { supported: false } },
      },
    });
    const discovery = await scimGet(reader, `/scim/endpoints/${endpointId}/ServiceProviderConfig`, readerToken).expect(200);
    expect(discovery.body).toMatchObject({ patch: { supported: false } });
  });

  it('refreshes mutable metadata and active-list membership when addressed by name', async () => {
    const url = `/scim/admin/endpoints/${originalName}`;
    await scimGet(reader, url, readerToken).expect(200);
    await scimPatch(writer, `/scim/admin/endpoints/${endpointId}`, token, {
      displayName: 'Updated freshness endpoint',
      active: false,
    }).expect(200);
    const result = await scimGet(reader, url, readerToken).expect(200);
    expect(result.body).toMatchObject({
      id: endpointId,
      name: originalName,
      displayName: 'Updated freshness endpoint',
      active: false,
    });
    const list = await scimGet(reader, '/scim/admin/endpoints?active=true', readerToken).expect(200);
    expect(endpointsFrom(list)).not.toContainEqual(expect.objectContaining({ id: endpointId }));
  });

  it('does not serve a deleted endpoint from either item or list cache', async () => {
    await scimGet(reader, `/scim/admin/endpoints/${endpointId}`, readerToken).expect(200);
    await scimDelete(writer, `/scim/admin/endpoints/${endpointId}`, token).expect(204);
    await scimGet(reader, `/scim/admin/endpoints/${endpointId}`, readerToken).expect(404);
    const list = await scimGet(reader, '/scim/admin/endpoints', readerToken).expect(200);
    expect(endpointsFrom(list)).not.toContainEqual(expect.objectContaining({ id: endpointId }));
  });
});
