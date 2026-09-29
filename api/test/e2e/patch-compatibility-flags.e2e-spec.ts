import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost, scimGet, scimPatch } from './helpers/request.helper';
import { USER, CONTOSO, PATCH, DIAGNOSTICS, typedPatchProfile } from './helpers/typed-patch-fixtures';
import { USER_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import type { IUserRepository } from '../../src/domain/repositories/user.repository.interface';
import type { SchemaAttributeDefinition } from '../../src/domain/validation/validation-types';
const NUMERIC_EXTENSION = 'urn:scimserver:devshapes:user:hr-extras:1.0';

describe('P2 default-running Entra integration and flag contracts', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app?.close(); });

  async function create(strict: boolean, verbose: boolean, coerce: boolean) {
    const profile = structuredClone(typedPatchProfile(strict));
    profile.settings.VerbosePatchSupported = verbose;
    profile.settings.AllowAndCoerceBooleanStrings = coerce;
    (profile.schemas.find(s => s.id === CONTOSO)!.attributes as SchemaAttributeDefinition[]).push({
      name: 'active', type: 'string', multiValued: false, required: false,
    });
    profile.schemas.push({ id: NUMERIC_EXTENSION, name: 'NumericVersion', attributes: [
      { name: 'label', type: 'string', multiValued: false, required: false },
    ] });
    profile.resourceTypes.find(rt => rt.schema === USER)!.schemaExtensions.push({ schema: NUMERIC_EXTENSION, required: false });
    const endpoint = await scimPost(app, '/scim/admin/endpoints', token, { name: `p2-flags-${randomUUID()}`, profile }).expect(201);
    const route = `/scim/endpoints/${endpoint.body.id}/Users`;
    const created = await scimPost(app, route, token, {
      schemas: [USER, CONTOSO, NUMERIC_EXTENSION], userName: `p2-${randomUUID()}`, active: true,
      name: { givenName: 'Given', familyName: 'Before' },
      emails: [{ type: 'home', value: 'old@example.test', primary: true }],
      [CONTOSO]: { active: 'original', contacts: [{ value: 'before', primary: false }] },
      [NUMERIC_EXTENSION]: { label: 'before' },
    }).expect(201);
    const url = `${route}/${created.body.id}`;
    const readStored = async () => {
      const stored = await app.get<IUserRepository>(USER_REPOSITORY).findByScimId(endpoint.body.id, created.body.id);
      if (!stored) throw new Error('Missing owned fixture');
      return { payload: JSON.parse(String(stored.rawPayload)), active: stored.active, version: stored.version };
    };
    const patch = (Operations: unknown[]) => scimPatch(app, url, token, { schemas: [PATCH], Operations });
    const unchanged = async (before: Awaited<ReturnType<typeof readStored>>) => {
      expect(await readStored()).toEqual(before);
      const read = await scimGet(app, url, token).expect(200);
      expect(read.body).toEqual(created.body);
      expect(read.headers.etag).toBe(created.headers.etag);
    };
    return { url, created, patch, readStored, unchanged };
  }

  it.each([true, false])('I02 appends new primary and clears old primary, strict=%s', async strict => {
    const resource = await create(strict, false, true);
    const response = await resource.patch([{ op: 'add', path: 'emails', value: [
      { type: 'work', value: 'new@example.test', primary: true },
    ] }]).expect(200);
    const expected = [
      { type: 'home', value: 'old@example.test', primary: false },
      { type: 'work', value: 'new@example.test', primary: true },
    ];
    expect(response.body.emails).toEqual(expected);
    expect((await resource.readStored()).payload.emails).toEqual(expected);
  });

  it.each(['add', 'replace', 'remove'])('keeps lenient numeric-version namespace %s supported with verbose OFF', async op => {
    const resource = await create(false, false, true);
    const response = await resource.patch([{
      op, path: NUMERIC_EXTENSION, ...(op === 'remove' ? {} : { value: { label: 'after' } }),
    }]).expect(200);
    const payload = (await resource.readStored()).payload;
    if (op === 'remove') {
      expect(Object.hasOwn(payload, NUMERIC_EXTENSION)).toBe(false);
      expect(Object.hasOwn(response.body, NUMERIC_EXTENSION)).toBe(false);
    } else {
      expect(payload[NUMERIC_EXTENSION]).toEqual({ label: 'after' });
      expect(response.body[NUMERIC_EXTENSION]).toEqual(payload[NUMERIC_EXTENSION]);
    }
  });

  describe.each([true, false])('strict=%s', strict => {
    it.each(['add', 'replace', 'remove'])('I03 rejects explicit dotted %s atomically when verbose is OFF', async op => {
      const resource = await create(strict, false, true);
      const before = await resource.readStored();
      const response = await resource.patch([
        { op: 'replace', path: 'displayName', value: 'must-not-persist' },
        { op, path: 'name.familyName', ...(op === 'remove' ? {} : { value: 'After' }) },
      ]);
      expect(response.status).toBe(400);
      expect(response.body.scimType).toBe('invalidPath');
      expect(response.body[DIAGNOSTICS]).toMatchObject({ failedOperationIndex: 1, failedPath: 'name.familyName' });
      await resource.unchanged(before);
    });
    it('resolves explicit dotted paths when verbose is ON', async () => {
      const resource = await create(strict, true, true);
      const response = await resource.patch([{ op: 'replace', path: 'name.familyName', value: 'After' }]).expect(200);
      expect(response.body.name).toEqual({ givenName: 'Given', familyName: 'After' });
      expect(Object.keys((await resource.readStored()).payload)).not.toContain('name.familyName');
    });
    it('E17 pathless dotted and registered-URN keys still resolve when verbose is OFF', async () => {
      const resource = await create(strict, false, true);
      const response = await resource.patch([{ op: 'replace', value: {
        'name.familyName': 'After', [`${CONTOSO}:active`]: 'False',
      } }]).expect(200);
      expect(response.body.name).toEqual({ givenName: 'Given', familyName: 'After' });
      expect(response.body[CONTOSO].active).toBe('False');
      const stored = await resource.readStored();
      expect(stored.payload.name).toEqual(response.body.name);
      expect(stored.payload[CONTOSO].active).toBe('False');
      expect(Object.keys(stored.payload)).not.toContain('name.familyName');
    });
    it.each(['path', 'qualified', 'pathless'])('coercion OFF rejects quoted active %s and makes no write', async form => {
      const resource = await create(strict, true, false);
      const before = await resource.readStored();
      const operation = form === 'pathless'
        ? { op: 'replace', value: { active: 'False' } }
        : { op: 'replace', path: form === 'qualified' ? `${USER}:active` : 'active', value: 'False' };
      const response = await resource.patch([operation]);
      expect(response.status).toBe(400);
      expect(response.body.scimType).toBe('invalidValue');
      await resource.unchanged(before);
    });
    it.each([true, false])('native active stays Boolean with coercion=%s', async coerce => {
      const resource = await create(strict, true, coerce);
      const response = await resource.patch([{ op: 'replace', path: 'active', value: false }]).expect(200);
      expect(response.body.active).toBe(false);
      expect((await resource.readStored()).active).toBe(false);
    });
    it('coercion ON preserves explicit legacy quoted-active compatibility', async () => {
      const resource = await create(strict, true, true);
      const response = await resource.patch([{ op: 'replace', path: 'active', value: 'False' }]).expect(200);
      expect(response.body.active).toBe(false);
      expect((await resource.readStored()).active).toBe(false);
    });
    it.each([true, false])('string-typed extension active is untouched by Boolean coercion=%s', async coerce => {
      const resource = await create(strict, true, coerce);
      await resource.patch([{ op: 'replace', path: `${CONTOSO}:active`, value: 'False' }]).expect(200);
      const stored = await resource.readStored();
      expect(stored.active).toBe(true);
      expect(stored.payload[CONTOSO].active).toBe('False');
    });
  });
  it.each([true, false])('legacy wrapper obeys explicit coercion setting even in lenient mode, coerce=%s', async coerce => {
    const resource = await create(false, true, coerce);
    const before = await resource.readStored();
    const response = await resource.patch([{ op: 'replace', path: 'active', value: { active: 'False' } }]);
    expect(response.status).toBe(coerce ? 200 : 400);
    if (coerce) expect((await resource.readStored()).active).toBe(false);
    else await resource.unchanged(before);
  });
});
