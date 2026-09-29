import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimGet, scimPatch } from './helpers/request.helper';
import {
  USER, GROUP, DEVICE, GOOGLE, CONTOSO, PATCH,
  typedPatchProfile, incidentPayload, incidentExpected, incidentOperations,
} from './helpers/typed-patch-fixtures';
import { SCIM_DIAGNOSTICS_URN } from '../../src/modules/scim/common/scim-constants';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY } from '../../src/domain/repositories/repository.tokens';

describe('P1 typed PATCH HTTP and persistence', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });
  afterAll(async () => { await app?.close(); });

  async function create(strict: boolean, family = 'Users') {
    const endpoint = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `p1-${randomUUID()}`, profile: typedPatchProfile(strict),
    }).expect(201);
    const base = `/scim/endpoints/${endpoint.body.id}/${family}`;
    const schema = family === 'Users' ? USER : family === 'Groups' ? GROUP : DEVICE;
    const created = await scimPost(app, base, token, {
      schemas: [schema, GOOGLE, CONTOSO],
      ...(family === 'Users' ? { userName: `p1-${randomUUID()}` } : { displayName: 'synthetic' }),
      ...incidentPayload(),
    }).expect(201);
    const repository = app.get<{
      findByScimId(...args: string[]): Promise<{ rawPayload: string; version: number } | null>;
    }>(family === 'Users' ? USER_REPOSITORY : family === 'Groups' ? GROUP_REPOSITORY : GENERIC_RESOURCE_REPOSITORY);
    const readStored = async () => {
      const args = family === 'Devices'
        ? [endpoint.body.id, 'Device', created.body.id] : [endpoint.body.id, created.body.id];
      const saved = await repository.findByScimId(...args);
      if (!saved) throw new Error('Missing persisted synthetic resource');
      return { payload: JSON.parse(saved.rawPayload), version: saved.version };
    };
    return { url: `${base}/${created.body.id}`, created, readStored };
  }

  describe.each([true, false])('StrictSchemaValidation=%s', strict => {
    it.each(['Users', 'Groups', 'Devices'])('updates all four incident values on %s', async family => {
      const { url, readStored } = await create(strict, family);
      const patched = await scimPatch(app, url, token, { schemas: [PATCH], Operations: incidentOperations() });
      expect({ status: patched.status, detail: patched.body.detail }).toEqual({ status: 200, detail: undefined });
      const stored = await readStored();
      expect(stored.payload[GOOGLE]).toEqual(incidentExpected()[GOOGLE]);
      expect(stored.payload[CONTOSO]).toEqual(incidentExpected()[CONTOSO]);
      for (const response of [patched, await scimGet(app, url, token).expect(200)]) {
        expect(response.body[GOOGLE]).toEqual(incidentExpected()[GOOGLE]);
        expect(response.body[CONTOSO]).toEqual(incidentExpected()[CONTOSO]);
        expect(Object.keys(response.body[CONTOSO])).toEqual(['contacts']);
        expect(Object.keys(response.body).every(key => [
          'schemas', 'id', 'userName', 'displayName', 'active', 'externalId', 'meta', 'members', GOOGLE, CONTOSO,
        ].includes(key))).toBe(true);
      }
    });

    it.each(['Users', 'Groups', 'Devices'])('rejects malformed paths atomically on %s', async family => {
      const { url, created, readStored } = await create(strict, family);
      const before = await readStored();
      const response = await scimPatch(app, url, token, {
        schemas: [PATCH],
        Operations: [
          incidentOperations()[0],
          { op: 'replace', path: `${CONTOSO}:contacts[primary xx true].value`, value: 'bad' },
        ],
      });
      expect(response.status).toBe(400);
      expect(response.body.scimType).toBe('invalidPath');
      expect(response.body[SCIM_DIAGNOSTICS_URN]).toMatchObject({
        failedOperationIndex: 1, failedPath: `${CONTOSO}:contacts[primary xx true].value`, failedOp: 'replace',
      });
      const after = await scimGet(app, url, token).expect(200);
      expect(after.body).toEqual(created.body);
      expect(after.headers.etag).toBe(created.headers.etag);
      expect(await readStored()).toEqual(before);
    });

    it.each(['Users', 'Groups', 'Devices'])('uses typed compound selectors and namespace caseExact on %s', async family => {
      const { url } = await create(strict, family);
      const path = `${CONTOSO.toUpperCase()}:CONTACTS`;
      const changed = await scimPatch(app, url, token, {
        schemas: [PATCH],
        Operations: [
          { op: 'replace', path: `${CONTOSO}:contacts`, value: [{ primary: true, rank: 12.5, code: 'AbC', type: 'work', value: 'old]' }] },
          { op: 'replace', path: `${path}[primary eq "True" and rank ge 1.25e1 and code eq "AbC" and type sw "WO"].VALUE`, value: 'changed' },
          { op: 'replace', path: `${path}[value pr and not (primary eq false) and missing eq null].rank`, value: 20 },
        ],
      }).expect(200);
      expect(changed.body[CONTOSO]).toEqual({
        contacts: [{ primary: true, rank: 20, code: 'AbC', type: 'work', value: 'changed' }],
      });
      const rejected = await scimPatch(app, url, token, {
        schemas: [PATCH], Operations: [{ op: 'replace', path: `${path}[code eq "abc"].value`, value: 'wrong-case' }],
      });
      expect(rejected.body.scimType).toBe('noTarget');
      expect(rejected.status).toBe(400);
      const after = await scimGet(app, url, token).expect(200);
      expect(after.body).toEqual(changed.body);
      expect(after.headers.etag).toBe(changed.headers.etag);
    });

    it.each(['Users', 'Devices'])('resolves qualified core selectors against the new working array on %s', async family => {
      const { url } = await create(strict, family);
      const core = family === 'Users' ? USER : DEVICE;
      const attribute = family === 'Users' ? 'emails' : 'contacts';
      const entry = { primary: true, value: 'first@example.test', ...(family === 'Devices' ? { rank: 12.5 } : {}) };
      const predicate = family === 'Devices' ? 'PRIMARY eq true and rank eq 1.25e1' : 'PRIMARY eq true';
      const changed = await scimPatch(app, url, token, {
        schemas: [PATCH], Operations: [
          { op: 'replace', path: `${core}:${attribute}`, value: [entry] },
          { op: 'replace', path: `${core.toUpperCase()}:${attribute.toUpperCase()}[${predicate}].VALUE`, value: 'second@example.test' },
        ],
      }).expect(200);
      expect(changed.body[attribute]).toEqual([{ ...entry, value: 'second@example.test' }]);
      const read = await scimGet(app, url, token).expect(200);
      expect(read.body[attribute]).toEqual(changed.body[attribute]);
      expect(Object.keys(read.body).some(k => k.includes('['))).toBe(false);
    });

    it('uses a compound core member selector against members added earlier in the request', async () => {
      const { url, readStored } = await create(strict, 'Groups');
      const usersUrl = url.slice(0, url.lastIndexOf('/Groups/')) + '/Users';
      const users = [];
      for (let i = 0; i < 2; i++) {
        const user = await scimPost(app, usersUrl, token, { schemas: [USER], userName: `p1-member-${randomUUID()}` }).expect(201);
        users.push(user.body.id as string);
      }
      const changed = await scimPatch(app, url, token, {
        schemas: [PATCH], Operations: [
          { op: 'replace', path: 'members', value: users.map(value => ({ value })) },
          { op: 'remove', path: `${GROUP.toUpperCase()}:MEMBERS[value eq "${users[0]}" and not (value eq "${users[1]}")]` },
        ],
      }).expect(200);
      expect(changed.body.members.map((m: { value: string }) => m.value)).toEqual([users[1]]);
      const read = await scimGet(app, url, token).expect(200);
      expect(read.body.members).toEqual(changed.body.members);
      expect((await readStored()).version).toBe(2);
    });
  });
});
