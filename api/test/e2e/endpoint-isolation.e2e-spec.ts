import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { resetDatabase } from './helpers/db.helper';
import {
  scimPost,
  scimGet,
  createEndpoint,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, validGroup, resetFixtureCounter } from './helpers/fixtures';

describe('Endpoint Isolation (E2E)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDatabase(app);
    resetFixtureCounter();
  });

  it('should not share users between endpoints', async () => {
    const endpointA = await createEndpoint(app, token, 'endpoint-a');
    const endpointB = await createEndpoint(app, token, 'endpoint-b');

    // Create user on Endpoint A
    const user = validUser();
    await scimPost(app, `${scimBasePath(endpointA)}/Users`, token, user).expect(201);

    // Endpoint A should see the user
    const resA = await scimGet(app, `${scimBasePath(endpointA)}/Users`, token).expect(200);
    expect(resA.body.totalResults).toBe(1);

    // Endpoint B should NOT see the user
    const resB = await scimGet(app, `${scimBasePath(endpointB)}/Users`, token).expect(200);
    expect(resB.body.totalResults).toBe(0);
  });

  it('should not share groups between endpoints', async () => {
    const endpointA = await createEndpoint(app, token, 'endpoint-a');
    const endpointB = await createEndpoint(app, token, 'endpoint-b');

    // Create group on Endpoint A
    await scimPost(app, `${scimBasePath(endpointA)}/Groups`, token, validGroup()).expect(201);

    // Endpoint A should see the group
    const resA = await scimGet(app, `${scimBasePath(endpointA)}/Groups`, token).expect(200);
    expect(resA.body.totalResults).toBe(1);

    // Endpoint B should NOT see the group
    const resB = await scimGet(app, `${scimBasePath(endpointB)}/Groups`, token).expect(200);
    expect(resB.body.totalResults).toBe(0);
  });

  it('should allow same userName on different endpoints', async () => {
    const endpointA = await createEndpoint(app, token, 'endpoint-a');
    const endpointB = await createEndpoint(app, token, 'endpoint-b');

    const user = validUser({ userName: 'shared@example.com' });

    await scimPost(app, `${scimBasePath(endpointA)}/Users`, token, user).expect(201);
    // Same userName should succeed on a different endpoint
    await scimPost(app, `${scimBasePath(endpointB)}/Users`, token, user).expect(201);
  });

  it('should allow same group displayName on different endpoints', async () => {
    const endpointA = await createEndpoint(app, token, 'endpoint-a');
    const endpointB = await createEndpoint(app, token, 'endpoint-b');

    const group = validGroup({ displayName: 'SharedGroup' });

    await scimPost(app, `${scimBasePath(endpointA)}/Groups`, token, group).expect(201);
    await scimPost(app, `${scimBasePath(endpointB)}/Groups`, token, group).expect(201);
  });

  it('should not return user from Endpoint A when querying by id on Endpoint B', async () => {
    const endpointA = await createEndpoint(app, token, 'endpoint-a');
    const endpointB = await createEndpoint(app, token, 'endpoint-b');

    const created = (await scimPost(
      app,
      `${scimBasePath(endpointA)}/Users`,
      token,
      validUser(),
    ).expect(201)).body;

    // Trying to GET the user id on Endpoint B should 404
    await scimGet(app, `${scimBasePath(endpointB)}/Users/${created.id}`, token).expect(404);
  });
});
