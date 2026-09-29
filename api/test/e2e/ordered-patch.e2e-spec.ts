import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import { scimPost as rawPost, scimGet as rawGet, scimPatch as rawPatch } from './helpers/request.helper';
import type { TypedHttpTest } from './helpers/typed-http';
import { typedPatchProfile, USER, GROUP, DEVICE, CONTOSO, PATCH, DIAGNOSTICS } from './helpers/typed-patch-fixtures';
import { USER_REPOSITORY, GROUP_REPOSITORY, GENERIC_RESOURCE_REPOSITORY } from '../../src/domain/repositories/repository.tokens';
import type { SchemaAttributeDefinition } from '../../src/domain/validation/validation-types';

interface StoredPayload extends Record<string, unknown> {
  [CONTOSO]: Record<string, unknown> & {
    contacts: Record<string, unknown>[];
    record: Record<string, unknown>;
  };
}
interface WireBody extends StoredPayload {
  id: string;
  emails: Record<string, unknown>[];
  [DIAGNOSTICS]: { failedOperationIndex: number };
}
const scimPost = (...args: Parameters<typeof rawPost>) => rawPost(...args) as unknown as TypedHttpTest<WireBody>;
const scimGet = (...args: Parameters<typeof rawGet>) => rawGet(...args) as unknown as TypedHttpTest<WireBody>;
const scimPatch = (...args: Parameters<typeof rawPatch>) => rawPatch(...args) as unknown as TypedHttpTest<WireBody>;
const storedPayload = (raw: string): StoredPayload => JSON.parse(raw) as StoredPayload;

const attr = (name: string, extra: Partial<SchemaAttributeDefinition> = {}): SchemaAttributeDefinition =>
  ({ name, type: 'string', required: false, multiValued: false, ...extra });
const typeValues: [string, unknown, unknown][] = [
  ['string', 'old', 'new'], ['boolean', false, true], ['integer', 2, 3], ['decimal', 2.5, 3.5],
  ['dateTime', '2026-09-28T01:00:00Z', '2026-09-28T02:00:00Z'],
  ['reference', 'https://example.test/one', 'https://example.test/two'],
  ['binary', 'YWJj', 'ZGVm'], ['complex', { label: 'old' }, { label: 'new' }],
];

describe('P2 ordered PATCH HTTP and repository contract', () => {
  let app: INestApplication;
  let token: string;
  beforeAll(async () => { app = await createTestApp(); token = await getAuthToken(app); });
  afterAll(async () => { await app?.close(); });

  async function create(family: string, strict = true, settings: Record<string, unknown> = {}, optionalExtension = false, nested = false) {
    const profile = structuredClone(typedPatchProfile(strict));
    const extension = profile.schemas.find(s => s.id === CONTOSO)!;
    (extension.attributes as SchemaAttributeDefinition[]).push(
      attr('tags', { multiValued: true }), attr('requiredValue', { required: !optionalExtension }),
      attr('identity', { mutability: 'immutable' }), attr('readOnlyValue', { mutability: 'readOnly' }),
      attr('secret', { mutability: 'writeOnly', returned: 'never' }),
      attr('record', { type: 'complex', subAttributes: [attr('tags', { multiValued: true }), attr('label'),
        attr('serverTags', { multiValued: true, mutability: 'readOnly' })] }),
      attr('fixedRecord', { type: 'complex', mutability: 'immutable', subAttributes: [attr('value'), attr('type')] }),
      ...typeValues.flatMap(([type]) => [false, true].map(multiValued =>
        attr(`${type}${multiValued ? 'List' : 'Single'}`, {
          type, multiValued, ...(type === 'complex' ? { subAttributes: [attr('label')] } : {}),
        }))),
    );
    const contacts = (extension.attributes as SchemaAttributeDefinition[]).find(a => a.name === 'contacts')!;
    contacts.subAttributes = [...contacts.subAttributes!, attr('tags', { multiValued: true }), attr('identity', { mutability: 'immutable' }),
      attr('server', { mutability: 'readOnly' })];
    if (nested) {
      const record = (extension.attributes as SchemaAttributeDefinition[]).find(a => a.name === 'record')!;
      record.subAttributes = [...record.subAttributes!, attr('children', { type: 'complex', multiValued: true,
        subAttributes: [attr('value'), attr('server', { mutability: 'readOnly' })] })];
    }
    const endpoint = await scimPost(app, '/scim/admin/endpoints', token, {
      name: `p2-${randomUUID()}`, profile: { ...profile, settings: { ...profile.settings, ...settings } },
    }).expect(201);
    const core = family === 'Users' ? USER : family === 'Groups' ? GROUP : DEVICE;
    const base = `/scim/endpoints/${endpoint.body.id}/${family}`;
    const created = await scimPost(app, base, token, {
      schemas: [core, CONTOSO], displayName: 'synthetic',
      ...(family === 'Users' ? { userName: `p2-${randomUUID()}` } : {}),
      [CONTOSO]: {
        tags: ['a'], requiredValue: 'required', record: { tags: ['a'], label: 'keep' }, secret: 'hidden',
        ...(!optionalExtension ? { fixedRecord: { value: 'same', type: 'work' } } : {}),
        contacts: [{ type: 'work', value: 'one', primary: true, tags: ['a'] }, { type: 'work', value: 'two', primary: false, tags: ['b'] }],
      },
    }).expect(201);
    const repository = app.get<{
      findByScimId(...args: string[]): Promise<{ id: string; rawPayload: string; version: number; externalId: string | null; displayName: string | null }>;
      update(id: string, data: { rawPayload: string }): Promise<unknown>;
    }>(
      family === 'Users' ? USER_REPOSITORY : family === 'Groups' ? GROUP_REPOSITORY : GENERIC_RESOURCE_REPOSITORY,
    );
    const findStored = () => repository.findByScimId(...(family === 'Devices'
        ? [endpoint.body.id, 'Device', created.body.id] : [endpoint.body.id, created.body.id]));
    const readStored = async () => {
      const saved = await findStored();
      return { payload: storedPayload(saved.rawPayload), version: saved.version };
    };
    const seedServerValue = async (onContact = false) => {
      const saved = await findStored();
      const payload = storedPayload(saved.rawPayload);
      if (onContact) payload[CONTOSO].contacts[0].server = 'server';
      else payload[CONTOSO].readOnlyValue = 'server';
      await repository.update(saved.id, { rawPayload: JSON.stringify(payload) });
    };
    const seedContacts = async (contacts: Record<string, unknown>[]) => {
      const saved = await findStored();
      const payload = storedPayload(saved.rawPayload);
      payload[CONTOSO].contacts = contacts;
      await repository.update(saved.id, { rawPayload: JSON.stringify(payload) });
    };
    const seedNested = async () => {
      const saved = await findStored();
      const payload = storedPayload(saved.rawPayload);
      payload[CONTOSO].record.children = [{ value: 'same', server: 'server' }];
      payload[CONTOSO].record.serverTags = ['server'];
      await repository.update(saved.id, { rawPayload: JSON.stringify(payload) });
    };
    return { url: `${base}/${created.body.id}`, created, readStored, findStored, seedServerValue, seedContacts, seedNested };
  }
  const patch = (url: string, Operations: unknown[]) => scimPatch(app, url, token, { schemas: [PATCH], Operations });

  describe.each(['Users', 'Groups', 'Devices'])('%s', family => {
    it('removes externalId from both payload and promoted repository column', async () => {
      const { url, findStored } = await create(family);
      await patch(url, [{ op: 'add', path: 'externalId', value: 'external' }]).expect(200);
      await patch(url, [{ op: 'remove', path: 'externalId' }]).expect(200);
      expect((await scimGet(app, url, token).expect(200)).body).not.toHaveProperty('externalId');
      expect((await findStored()).externalId).toBeNull();
    });
    it('does not grow preserved server collections during repeated sibling adds', async () => {
      const { url, readStored, seedNested } = await create(family, true, { RfcCompliantSubAttributes: false }, false, true);
      await seedNested();
      await patch(url, [
        { op: 'add', path: `${CONTOSO}:record`, value: { label: 'new' } },
        { op: 'add', path: `${CONTOSO}:record`, value: { label: 'newer' } },
      ]).expect(200);
      const record = (await readStored()).payload[CONTOSO].record;
      expect(record.label).toBe('newer');
      expect(record.serverTags).toEqual(['server']);
      expect(record.children).toEqual([{ value: 'same', server: 'server' }]);
    });
    it('does not discard server fields through add-null unassignment', async () => {
      const { url, readStored, seedServerValue } = await create(family);
      await seedServerValue(true);
      const before = await readStored();
      await patch(url, [{ op: 'add', path: `${CONTOSO}:contacts`, value: null }]).expect(400);
      expect(await readStored()).toEqual(before);
    });
    it('does not copy server fields when a compatibility complex parent appends nested entries', async () => {
      const { url, readStored, seedNested } = await create(family, true, { RfcCompliantSubAttributes: false }, false, true);
      await seedNested();
      await patch(url, [{ op: 'add', path: `${CONTOSO}:record`, value: { children: [{ value: 'same' }] } }]).expect(200);
      expect((await readStored()).payload[CONTOSO].record.children)
        .toEqual([{ value: 'same', server: 'server' }, { value: 'same' }]);
    });
    it.each([true, false])('nested add-null preserves unassignment instead of appending, strict=%s', async strict => {
      const { url, readStored, seedNested } = await create(family, strict,
        { RfcCompliantSubAttributes: false, IgnoreReadOnlyAttributesInPatch: true }, false, true);
      await seedNested();
      await patch(url, [{ op: 'add', path: `${CONTOSO}:record`, value: { children: null } }]).expect(200);
      expect((await readStored()).payload[CONTOSO].record.children).toEqual([{ server: 'server' }]);
    });
    it('keeps distinct server values on duplicated and anonymous retained entries', async () => {
      const { url, readStored, seedContacts } = await create(family);
      await seedContacts([
        { value: 'same', type: 'home', server: 'home-server' },
        { value: 'same', type: 'work', server: 'work-server' },
        { type: 'anonymous', server: 'anonymous-server' },
      ]);
      await patch(url, [{ op: 'replace', path: `${CONTOSO}:contacts`, value: [
        { value: 'same', type: 'work' }, { value: 'same', type: 'home' }, { type: 'anonymous' },
      ] }]).expect(200);
      expect((await readStored()).payload[CONTOSO].contacts).toEqual([
        { value: 'same', type: 'work', server: 'work-server' },
        { value: 'same', type: 'home', server: 'home-server' },
        { type: 'anonymous', server: 'anonymous-server' },
      ]);
    });
    it('retains server-owned descendants when replacing an existing array identity', async () => {
      const { url, readStored, seedServerValue } = await create(family);
      await seedServerValue(true);
      await patch(url, [{ op: 'replace', path: `${CONTOSO}:contacts`, value: [{ value: 'one' }] }]).expect(200);
      expect((await readStored()).payload[CONTOSO].contacts).toEqual([{ value: 'one', server: 'server' }]);
    });
    it('materializes new multi-valued children before a subsequent append', async () => {
      const { url, readStored } = await create(family);
      await patch(url, [
        { op: 'add', path: `${CONTOSO}:contacts`, value: { value: 'three', tags: 'b' } },
        { op: 'add', path: `${CONTOSO}:contacts[value eq "three"].tags`, value: 'c' },
      ]).expect(200);
      expect((await readStored()).payload[CONTOSO].contacts[2].tags).toEqual(['b', 'c']);
    });
    it.each(typeValues)('preserves %s scalar and list shapes across ordered add/replace', async (type, first, second) => {
      const { url, readStored } = await create(family);
      const response = await patch(url, [
        { op: 'add', path: `${CONTOSO}:${type}Single`, value: first },
        { op: 'replace', path: `${CONTOSO}:${type}Single`, value: second },
        { op: 'add', path: `${CONTOSO}:${type}List`, value: [first] },
        { op: 'add', path: `${CONTOSO}:${type}List`, value: second },
      ]);
      expect({ status: response.status, detail: response.body.detail }).toEqual({ status: 200, detail: undefined });
      for (const body of [response.body, (await scimGet(app, url, token).expect(200)).body, (await readStored()).payload]) {
        expect(body[CONTOSO][`${type}Single`]).toEqual(second);
        expect(body[CONTOSO][`${type}List`]).toEqual([first, second]);
      }
    });
    it.each([true, false])('appends scalar, array, no-path and complex adds; strict=%s', async strict => {
      const { url, readStored } = await create(family, strict);
      const response = await patch(url, [
        { op: 'add', path: `${CONTOSO}:tags`, value: ['b'] },
        { op: 'add', path: `${CONTOSO}:tags`, value: 'c' },
        { op: 'add', value: { [CONTOSO]: { tags: 'd' } } },
        { op: 'add', path: `${CONTOSO}:record`, value: { tags: 'b' } },
        { op: 'add', path: `${CONTOSO}:contacts[type eq "work"].tags`, value: 'c' },
      ]);
      expect({ status: response.status, detail: response.body.detail }).toEqual({ status: 200, detail: undefined });
      for (const body of [response.body, (await scimGet(app, url, token).expect(200)).body, (await readStored()).payload]) {
        expect(body[CONTOSO]).toMatchObject({ tags: ['a', 'b', 'c', 'd'], record: { tags: ['a', 'b'], label: 'keep' } });
        expect(body[CONTOSO].contacts.map(c => c.tags)).toEqual([['a', 'c'], ['b', 'c']]);
        expect(JSON.stringify(body)).not.toContain('contacts[');
      }
      expect(response.body[CONTOSO]).not.toHaveProperty('secret');
      expect((await readStored()).payload[CONTOSO].secret).toBe('hidden');
    });
    it('replaces every selected object and preserves unspecified fields', async () => {
      const { url, readStored } = await create(family);
      const response = await patch(url, [{ op: 'replace', path: `${CONTOSO}:contacts[type eq "work"]`, value: { value: 'changed' } }]);
      expect({ status: response.status, detail: response.body.detail }).toEqual({ status: 200, detail: undefined });
      expect(response.body[CONTOSO].contacts.map(c => [c.value, c.type]))
        .toEqual([['changed', 'work'], ['changed', 'work']]);
      expect((await readStored()).payload[CONTOSO].contacts).toEqual(response.body[CONTOSO].contacts);
    });
    it('allows a no-op immutable complex child update with different key ordering', async () => {
      const { url } = await create(family);
      const response = await patch(url, [{ op: 'replace', path: `${CONTOSO}:fixedRecord.value`, value: 'same' }]).expect(200);
      expect(response.body[CONTOSO].fixedRecord).toEqual({ value: 'same', type: 'work' });
    });
    it.each([[true, false, 400], [true, true, 200], [false, false, 200]])(
      'guards expanded no-path readOnly targets strict=%s ignore=%s', async (strict, ignore, status) => {
        const { url, readStored, seedServerValue } = await create(family, strict, { IgnoreReadOnlyAttributesInPatch: ignore });
        await seedServerValue();
        const response = await patch(url, [{ op: 'replace', value: { [`${CONTOSO}:readOnlyValue`]: 'client' } }]);
        expect(response.status).toBe(status);
        expect((await readStored()).payload[CONTOSO].readOnlyValue).toBe('server');
      },
    );
    it.each([[true, false, 400], [true, true, 200], [false, false, 200]])(
      'guards namespace readOnly descendants strict=%s ignore=%s', async (strict, ignore, status) => {
        const { url, readStored, seedServerValue } = await create(family, strict, { IgnoreReadOnlyAttributesInPatch: ignore }, true);
        await seedServerValue();
        const before = await readStored();
        const response = await patch(url, [{ op: 'replace', value: { [CONTOSO]: null } }]);
        expect({ status: response.status, detail: status === 200 ? response.body.detail : undefined }).toEqual({ status, detail: undefined });
        const after = await readStored();
        if (status === 200) expect(after.payload[CONTOSO]).toEqual({ readOnlyValue: 'server' });
        else expect(after).toEqual(before);
      },
    );
    it.each(['reject', 'normalize', 'passthrough'])('hands primary off before next selector under %s', async mode => {
      const { url, readStored } = await create(family, true, { PrimaryEnforcement: mode });
      const response = await patch(url, [
        { op: 'replace', path: `${CONTOSO}:contacts[value eq "two"].primary`, value: true },
        { op: 'replace', path: `${CONTOSO}:contacts[primary eq true].value`, value: 'selected' },
      ]);
      expect({ status: response.status, detail: response.body.detail }).toEqual({ status: 200, detail: undefined });
      expect(response.body[CONTOSO].contacts.map(c => [c.value, c.primary]))
        .toEqual([['one', false], ['selected', true]]);
      expect((await readStored()).payload[CONTOSO].contacts).toEqual(response.body[CONTOSO].contacts);
    });
    it.each(['requiredValue', 'identity'])('enforces %s transitions with strict validation disabled', async name => {
      const { url, readStored } = await create(family, false);
      const before = await readStored();
      const operations = name === 'requiredValue'
        ? [{ op: 'remove', path: `${CONTOSO}:requiredValue` }, { op: 'add', path: `${CONTOSO}:requiredValue`, value: 'repair' }]
        : [{ op: 'add', path: `${CONTOSO}:identity`, value: 'first' }, { op: 'replace', path: `${CONTOSO}:identity`, value: 'second' }];
      const response = await patch(url, operations);
      expect(response.status).toBe(400);
      expect(response.body.scimType).toBe(name === 'requiredValue' ? 'invalidValue' : 'mutability');
      expect(await readStored()).toEqual(before);
    });
    it.each([
      ['required removal', [{ op: 'remove', path: `${CONTOSO}:requiredValue` }, { op: 'add', path: `${CONTOSO}:requiredValue`, value: 'repair' }], 'invalidValue', 0],
      ['immutable second write', [{ op: 'add', path: `${CONTOSO}:identity`, value: 'first' }, { op: 'replace', path: `${CONTOSO}:identity`, value: 'second' }], 'mutability', 1],
      ['immutable removal', [{ op: 'add', path: `${CONTOSO}:identity`, value: 'first' }, { op: 'remove', path: `${CONTOSO}:identity` }], 'mutability', 1],
      ['immutable list child', [{ op: 'replace', path: `${CONTOSO}:contacts`, value: [{ value: 'one', identity: 'first' }] }, { op: 'replace', path: `${CONTOSO}:contacts`, value: [{ value: 'one', identity: 'second' }] }], 'mutability', 1],
      ['selected shape', [{ op: 'replace', path: `${CONTOSO}:contacts[type eq "work"]`, value: 'bad' }], 'invalidValue', 0],
      ['unknown selector', [{ op: 'replace', path: `${CONTOSO}:unknown[type eq "work"].value`, value: 'bad' }], 'invalidPath', 0],
      ['missing selection', [{ op: 'replace', path: `${CONTOSO}:contacts[type eq "missing"].value`, value: 'bad' }], 'noTarget', 0],
    ])('rejects %s with no repository write', async (_name, operations, scimType, index) => {
      const { url, created, readStored } = await create(family);
      const before = await readStored();
      const response = await patch(url, operations);
      expect(response.status).toBe(400);
      expect(response.body.scimType).toBe(scimType);
      expect(response.body[DIAGNOSTICS].failedOperationIndex).toBe(index);
      expect(await readStored()).toEqual(before);
      const read = await scimGet(app, url, token).expect(200);
      expect(read.body).toEqual(created.body);
      expect(read.headers.etag).toBe(created.headers.etag);
      expect(Object.keys(response.body).every(k => ['schemas', 'status', 'scimType', 'detail', DIAGNOSTICS].includes(k))).toBe(true);
    });
    it.each([[true, false, 400], [true, true, 200], [false, false, 200]])(
      'keeps readOnly compatibility strict=%s ignore=%s', async (strict, ignore, status) => {
        const { url, readStored } = await create(family, strict, { IgnoreReadOnlyAttributesInPatch: ignore });
        const response = await patch(url, [
          { op: 'replace', path: `${CONTOSO}:readOnlyValue`, value: 'discard' },
          { op: 'add', path: `${CONTOSO}:tags`, value: ['kept'] },
        ]);
        expect(response.status).toBe(status);
        const stored = (await readStored()).payload[CONTOSO];
        expect(stored).not.toHaveProperty('readOnlyValue');
        expect(stored.tags).toEqual(status === 200 ? ['a', 'kept'] : ['a']);
      },
    );
  });
  it.each(['reject', 'normalize', 'passthrough'])('User equality synthesis hands off primary under %s', async mode => {
    const { url } = await create('Users', true, { PrimaryEnforcement: mode });
    const response = await patch(url, [
      { op: 'add', path: 'emails', value: [{ type: 'home', value: 'old@example.test', primary: true }] },
      { op: 'add', path: 'emails[type eq "work"].primary', value: true },
      { op: 'replace', path: 'emails[primary eq true].value', value: 'new@example.test' },
    ]).expect(200);
    expect(response.body.emails.map(email => [email.primary, email.value]))
      .toEqual([[false, 'old@example.test'], [true, 'new@example.test']]);
  });
  it.each([true, false])('User quoted Boolean synthesis hands off primary strict=%s', async strict => {
    const { url } = await create('Users', strict, { PrimaryEnforcement: 'reject' });
    await patch(url, [{ op: 'add', path: 'emails', value: [{ value: 'old@example.test', primary: true }] }]).expect(200);
    const response = await patch(url, [
      { op: 'add', path: 'emails[primary eq "True"].value', value: 'updated@example.test' },
      { op: 'add', path: 'emails[type eq "work"].primary', value: 'True' },
      { op: 'replace', path: 'emails[primary eq true].value', value: 'selected@example.test' },
    ]);
    expect({ status: response.status, detail: response.body.detail }).toEqual({ status: 200, detail: undefined });
    expect(response.body.emails.map(email => email.primary)).toEqual([false, true]);
  });
  it('Group scalar selectors cannot bypass matching through promoted-field hooks', async () => {
    const { url, readStored } = await create('Groups');
    const before = await readStored();
    await patch(url, [{ op: 'replace', path: 'externalId[value eq "missing"]', value: 'bad' }]).expect(400);
    expect(await readStored()).toEqual(before);
  });
  it.each([true, false])('User synthesized entry cannot write a readOnly child strict=%s', async strict => {
    const profile = structuredClone(typedPatchProfile(strict));
    profile.schemas.find(s => s.id === USER)!.attributes = [
      attr('userName', { required: true }), attr('displayName'), attr('active', { type: 'boolean' }),
      attr('emails', { type: 'complex', multiValued: true, subAttributes: [
        attr('type'), attr('value'), attr('server', { mutability: 'readOnly' }),
      ] }),
    ];
    const endpoint = await scimPost(app, '/scim/admin/endpoints', token, { name: `p2-synth-${randomUUID()}`, profile }).expect(201);
    const route = `/scim/endpoints/${endpoint.body.id}/Users`;
    const created = await scimPost(app, route, token, { schemas: [USER], userName: 'synthetic' }).expect(201);
    const url = `${route}/${created.body.id}`;
    const response = await patch(url, [{ op: 'add', path: 'emails[type eq "work"]', value: { value: 'new@example.test', server: 'client' } }]);
    expect(response.status).toBe(strict ? 400 : 200);
    const read = await scimGet(app, url, token).expect(200);
    if (strict) expect(read.body).toEqual(created.body);
    else expect(read.body.emails).toEqual([{ type: 'work', value: 'new@example.test' }]);
  });
});
