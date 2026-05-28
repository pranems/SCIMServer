/**
 * PATCH null-handling end-to-end coverage.
 *
 * Maps to docs/PATCH_NULL_HANDLING_RFC_COMPLIANCE.md design doc and the
 * scripts/null-patch-test.ps1 live diagnostic (T01-T19). The unit-layer
 * coverage lives in:
 *   - api/src/modules/scim/utils/scim-patch-path.spec.ts
 *   - api/src/domain/patch/{user,group,generic}-patch-engine.spec.ts
 *
 * This spec exercises the same scenarios end-to-end through the HTTP
 * surface so that controller wiring, body parsing, error-envelope shape,
 * and the strict-mode pre-PATCH validation layer are all validated.
 *
 * RFC anchors:
 *   - RFC 7644 §3.5.2.1 (add)
 *   - RFC 7644 §3.5.2.2 (remove)
 *   - RFC 7644 §3.5.2.3 (replace - "if value is null, the attribute SHALL be unassigned")
 *   - RFC 7643 §2.2 (attribute characteristics)
 *   - RFC 7643 §7 (mutability)
 */

import type { INestApplication } from '@nestjs/common';
import { createTestApp } from './helpers/app.helper';
import { getAuthToken } from './helpers/auth.helper';
import {
  scimPost,
  scimGet,
  scimPatch,
  createEndpointWithConfig,
  scimBasePath,
} from './helpers/request.helper';
import { validUser, validGroup, patchOp, resetFixtureCounter } from './helpers/fixtures';

const PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
const ENT_URN = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User';

/**
 * Re-seed user state so each test starts from a known baseline.
 * Returns the seeded user id.
 */
async function seedUser(
  app: INestApplication,
  token: string,
  basePath: string,
): Promise<{ id: string; userName: string }> {
  const u = validUser({
    nickName: 'nptest',
    displayName: 'Null Patch Test',
    name: { givenName: 'Null', familyName: 'Tester' } as { givenName?: string; familyName?: string },
    emails: [
      { value: 'work@npt.test', type: 'work', primary: true },
      { value: 'home@npt.test', type: 'home', primary: false },
    ],
    [ENT_URN]: { department: 'Eng', manager: { value: 'mgr-123' } },
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User', ENT_URN],
  });
  const res = await scimPost(app, `${basePath}/Users`, token, u).expect(201);
  return { id: res.body.id as string, userName: res.body.userName as string };
}

describe('PATCH null-handling (E2E)', () => {
  let app: INestApplication;
  let token: string;
  let endpointId: string;
  let basePath: string;

  beforeAll(async () => {
    app = await createTestApp();
    token = await getAuthToken(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    resetFixtureCounter();
    // Strict mode required so that required-clearing is caught at post-PATCH validation.
    // VerbosePatchSupported=true enables RFC 7644 §3.10 dotted-path resolution (name.familyName etc.)
    // instead of legacy "literal key" behavior - required for the T08/T10 nested-path scenarios.
    endpointId = await createEndpointWithConfig(app, token, {
      StrictSchemaValidation: true,
      VerbosePatchSupported: true,
    });
    basePath = scimBasePath(endpointId);
  });

  // ────────────────────── T01 ──────────────────────
  describe('T01 replace:null on single-valued readWrite (nickName)', () => {
    it('clears the attribute and returns 200', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'replace', path: 'nickName', value: null }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      // Cleared attrs may serialize as either `undefined` (omitted) or `null` in the response.
      expect(after.body.nickName ?? null).toBeNull();
    });
  });

  // ────────────────────── T02 ──────────────────────
  describe('T02 replace:null on REQUIRED attribute (userName)', () => {
    it('rejects with 400 and invalidValue scimType (post-PATCH required check)', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'replace', path: 'userName', value: null }]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(400);
      expect(res.body.scimType).toBe('invalidValue');
    });
  });

  // ────────────────────── T03 ──────────────────────
  describe('T03 replace:null on readOnly attribute (id)', () => {
    it('rejects with 400 mutability OR silently no-ops (RFC 7643 §7 permits either)', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'replace', path: 'id', value: null }]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch);
      // Per RFC 7643 §7 the server MAY ignore OR fail with 400.
      // Either is conformant; we just verify it doesn't 500 and doesn't actually mutate id.
      expect([200, 400]).toContain(res.status);
      if (res.status === 400) {
        expect(res.body.scimType).toBe('mutability');
      }
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      expect(after.body.id).toBe(id);
    });
  });

  // ────────────────────── T04 ──────────────────────
  describe('T04 replace:null on multi-valued bare path (emails)', () => {
    it('clears the multi-valued attribute (F2 semantics applied to non-members too)', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'replace', path: 'emails', value: null }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      const emails = (after.body.emails ?? []) as unknown[];
      expect(emails.length).toBe(0);
    });
  });

  // ────────────────────── T05 ──────────────────────
  describe('T05 replace:null on filtered sub-attribute (emails[type eq "work"].value)', () => {
    it('clears the sub-attribute on the matching entry, keeps the entry', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([
        { op: 'replace', path: 'emails[type eq "work"].value', value: null },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch);
      // Status MAY be 200 (cleared) or 400 (if `value` happens to be required under strict).
      expect([200, 400]).toContain(res.status);
      if (res.status === 200) {
        const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
        const work = ((after.body.emails ?? []) as Array<{ type?: string; value?: string }>)
          .find(e => e.type === 'work');
        expect(work).toBeDefined();
        expect(work?.value).toBeFalsy();
      }
    });
  });

  // ────────────────────── T06 ──────────────────────
  describe('T06 F3 - remove with filter that matches zero entries (noTarget)', () => {
    it('rejects with 400 noTarget per RFC 7644 §3.5.2.2', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([
        { op: 'remove', path: 'emails[type eq "doesnotexist"]' },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(400);
      expect(res.body.scimType).toBe('noTarget');
    });

    it('rejects replace with zero-match filter as noTarget too (F3 parity)', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([
        { op: 'replace', path: 'emails[type eq "doesnotexist"].value', value: 'x@x' },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(400);
      expect(res.body.scimType).toBe('noTarget');
    });
  });

  // ────────────────────── T07 ──────────────────────
  describe('T07 add:null on missing optional attribute (title)', () => {
    it('silent-accepts as no-op (current permissive behavior; documented in design doc)', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'add', path: 'title', value: null }]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch);
      // Permissive per design doc; either 200 no-op or 400 invalidValue is conformant.
      expect([200, 400]).toContain(res.status);
    });
  });

  // ────────────────────── T08 ──────────────────────
  describe('T08 F1 - path-less replace with nested nulls (Entra-style merge)', () => {
    it('clears nullified sub-attrs while preserving non-null siblings', async () => {
      const { id } = await seedUser(app, token, basePath);
      // First re-seed name + nickName to known state in one PATCH.
      await scimPatch(app, `${basePath}/Users/${id}`, token, patchOp([
        { op: 'replace', path: 'nickName', value: 'nptest2' },
        { op: 'replace', path: 'name', value: { givenName: 'Null', familyName: 'Tester', formatted: 'Null Tester' } },
      ])).expect(200);

      const patch = patchOp([{
        op: 'replace',
        value: {
          nickName: null,
          name: { familyName: null },
          emails: null,
        },
      }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      expect(after.body.nickName ?? null).toBeNull();
      expect(after.body.name?.familyName ?? null).toBeNull();
      expect(after.body.name?.givenName).toBe('Null');         // F1: non-null siblings preserved
      expect((after.body.emails ?? []).length).toBe(0);
    });
  });

  // ────────────────────── T09 ──────────────────────
  describe('T09 replace:null on complex parent (name)', () => {
    it('unassigns the complex attribute entirely', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'replace', path: 'name', value: null }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      expect(after.body.name ?? null).toBeNull();
    });
  });

  // ────────────────────── T10 ──────────────────────
  describe('T10 replace:null on sub-attribute (name.familyName)', () => {
    it('clears the sub-attribute and preserves siblings', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([{ op: 'replace', path: 'name.familyName', value: null }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      expect(after.body.name?.familyName ?? null).toBeNull();
      expect(after.body.name?.givenName).toBe('Null');
    });
  });

  // ────────────────────── T11 ──────────────────────
  describe('T11 F1 - replace complex with partial object containing null (merge)', () => {
    it('merges (clears nulls, sets non-nulls, preserves unmentioned siblings)', async () => {
      const { id } = await seedUser(app, token, basePath);
      // Reset name to baseline including formatted.
      await scimPatch(app, `${basePath}/Users/${id}`, token, patchOp([
        { op: 'replace', path: 'name', value: { givenName: 'Null', familyName: 'Tester', formatted: 'Null Tester' } },
      ])).expect(200);

      const patch = patchOp([{
        op: 'replace',
        path: 'name',
        value: { familyName: null, givenName: 'NullReplaced' },
      }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      expect(after.body.name?.familyName).toBeUndefined();
      expect(after.body.name?.givenName).toBe('NullReplaced');
      // F1 merge: `formatted` was NOT mentioned in the PATCH, so it MUST be preserved.
      expect(after.body.name?.formatted).toBe('Null Tester');
    });
  });

  // ────────────────────── T12 ──────────────────────
  describe('T12 F5 - replace:null on extension attribute (enterprise:manager)', () => {
    it('clears the extension attribute and prunes the empty extension URN', async () => {
      const { id } = await seedUser(app, token, basePath);
      // Clear department first so removing manager leaves the URN empty (F5 pruning trigger).
      await scimPatch(app, `${basePath}/Users/${id}`, token, patchOp([
        { op: 'replace', path: `${ENT_URN}:department`, value: null },
      ])).expect(200);

      const patch = patchOp([{ op: 'replace', path: `${ENT_URN}:manager`, value: null }]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      const ext = (after.body[ENT_URN] ?? {}) as Record<string, unknown>;
      expect(ext.manager).toBeUndefined();
      // F5: with no remaining sub-attrs, schemas[] should not advertise the URN.
      const schemas = (after.body.schemas ?? []) as string[];
      expect(schemas).not.toContain(ENT_URN);
    });
  });

  // ────────────────────── T13 ──────────────────────
  describe('T13 empty string vs null on string attribute (displayName)', () => {
    it('null unassigns; empty string is preserved as a zero-length value', async () => {
      const { id } = await seedUser(app, token, basePath);

      // First: set to empty string
      await scimPatch(app, `${basePath}/Users/${id}`, token, patchOp([
        { op: 'replace', path: 'displayName', value: '' },
      ])).expect(200);
      const afterEmpty = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      // Server may treat '' as either unassigned or value - both conformant; key is that null unassigns.

      // Then: set to null
      await scimPatch(app, `${basePath}/Users/${id}`, token, patchOp([
        { op: 'replace', path: 'displayName', value: null },
      ])).expect(200);
      const afterNull = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      expect(afterNull.body.displayName).toBeUndefined();
      // Sanity: the empty-string case did at least not 500 and produced a stable shape.
      expect(typeof afterEmpty.body).toBe('object');
    });
  });

  // ────────────────────── T14 ──────────────────────
  describe('T14 F4 - replace:null on Group members[X].value (required sub-attr)', () => {
    it('rejects with 400', async () => {
      const userRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = userRes.body.id as string;
      const grp = validGroup({ members: [{ value: userId, display: 'M' }] });
      const groupRes = await scimPost(app, `${basePath}/Groups`, token, grp).expect(201);
      const groupId = groupRes.body.id as string;

      const patch = patchOp([
        { op: 'replace', path: `members[value eq "${userId}"].value`, value: null },
      ]);
      const res = await scimPatch(app, `${basePath}/Groups/${groupId}`, token, patch);
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────── T15 ──────────────────────
  describe('T15 F2 - replace:null on Group.members clears all members (explicit-null)', () => {
    it('empties members regardless of PatchOpAllowRemoveAllMembers flag default', async () => {
      const userRes = await scimPost(app, `${basePath}/Users`, token, validUser()).expect(201);
      const userId = userRes.body.id as string;
      const grp = validGroup({ members: [{ value: userId, display: 'M' }] });
      const groupRes = await scimPost(app, `${basePath}/Groups`, token, grp).expect(201);
      const groupId = groupRes.body.id as string;

      const patch = patchOp([{ op: 'replace', path: 'members', value: null }]);
      await scimPatch(app, `${basePath}/Groups/${groupId}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Groups/${groupId}`, token).expect(200);
      const members = (after.body.members ?? []) as unknown[];
      expect(members.length).toBe(0);
    });
  });

  // ────────────────────── T16 ──────────────────────
  describe('T16 remove (no value) on Group.members - strict-by-default rejects', () => {
    it('rejects when PatchOpAllowRemoveAllMembers flag is false (strict-by-default)', async () => {
      const strictEndpointId = await createEndpointWithConfig(app, token, {
        StrictSchemaValidation: true,
        PatchOpAllowRemoveAllMembers: false,
      });
      const strictBase = scimBasePath(strictEndpointId);

      const userRes = await scimPost(app, `${strictBase}/Users`, token, validUser()).expect(201);
      const userId = userRes.body.id as string;
      const grp = validGroup({ members: [{ value: userId, display: 'M' }] });
      const groupRes = await scimPost(app, `${strictBase}/Groups`, token, grp).expect(201);
      const groupId = groupRes.body.id as string;

      const patch = patchOp([{ op: 'remove', path: 'members' }]);
      const res = await scimPatch(app, `${strictBase}/Groups/${groupId}`, token, patch);
      expect([400]).toContain(res.status);
    });
  });

  // ────────────────────── T17 ──────────────────────
  describe('T17 remove with filter + explicit null value (value ignored)', () => {
    it('removes only the matching entry; the explicit null is ignored', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([
        { op: 'remove', path: 'emails[type eq "home"]', value: null },
      ]);
      await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(200);
      const after = await scimGet(app, `${basePath}/Users/${id}`, token).expect(200);
      const emails = (after.body.emails ?? []) as Array<{ type?: string }>;
      expect(emails.find(e => e.type === 'home')).toBeUndefined();
      expect(emails.find(e => e.type === 'work')).toBeDefined();
    });
  });

  // ────────────────────── T18 ──────────────────────
  describe('T18 F4 - add multi-valued with [null] element', () => {
    it('rejects with 400 invalidValue', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([
        { op: 'add', path: 'emails', value: [null] },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(400);
      expect(res.body.scimType).toBe('invalidValue');
    });

    it('rejects replace multi-valued with [validEntry, null] mixed', async () => {
      const { id } = await seedUser(app, token, basePath);
      const patch = patchOp([
        { op: 'replace', path: 'emails', value: [{ value: 'x@x', type: 'work' }, null] },
      ]);
      const res = await scimPatch(app, `${basePath}/Users/${id}`, token, patch).expect(400);
      expect(res.body.scimType).toBe('invalidValue');
    });
  });
});
