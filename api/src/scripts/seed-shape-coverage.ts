/**
 * seed-shape-coverage.ts
 *
 * Lays a *minimum-resource maximum-coverage* set of synthetic SCIM fixtures on
 * top of whatever already exists in the target database. Designed to run AFTER
 * mirror-prod-to-dev.ts so dev contains:
 *
 *   (a) every prod resource (with original IDs) for repro work, plus
 *   (b) ~6 small synthetic endpoints that together exercise every interesting
 *       config / shape combination the SCIMServer supports.
 *
 * All synthetic endpoints are prefixed `shape-` so they are trivial to spot in
 * the UI and easy to drop with a single SQL DELETE in scripts/state if needed.
 *
 * COVERAGE MATRIX (6 endpoints × 5 resources each = 30 SCIM resources)
 *
 *   shape-rfc-strict          rfc-standard preset; StrictSchemaValidation=true,
 *                             RequireIfMatch=true, PrimaryEnforcement=reject,
 *                             AllowAndCoerceBooleanStrings=false
 *   shape-entra-lenient       entra-id preset; AllowAndCoerceBooleanStrings=true,
 *                             IgnoreReadOnlyAttributesInPatch=true,
 *                             IncludeWarningAboutIgnoredReadOnlyAttribute=true,
 *                             VerbosePatchSupported=false (Entra-style flat keys)
 *   shape-custom-ext-user     user-only-with-custom-ext preset (User-only,
 *                             custom extension attrs incl writeOnly + never)
 *   shape-soft-delete-only    entra-id-minimal preset; UserSoftDeleteEnabled=true,
 *                             UserHardDeleteEnabled=false, GroupHardDeleteEnabled=false
 *   shape-per-endpoint-creds  entra-id preset; PerEndpointCredentialsEnabled=true,
 *                             plus 1 EndpointCredential row (bcrypt of "shape-secret")
 *   shape-custom-resource     INLINE custom profile: User + Group + custom Device
 *                             resourceType with its own URN + custom extension on User.
 *                             VerbosePatchSupported=true. Tests custom resource type
 *                             registration end-to-end.
 *
 * USERS per endpoint (3):
 *   u1.minimal     - just userName, default attrs
 *   u2.rich        - name (givenName/familyName), 2 emails (1 primary), 1 phone,
 *                    externalId, active=true; on extension endpoints also includes
 *                    extension attributes
 *   u3.edge        - active=false (deactivated), externalId only, no name/email;
 *                    on the multi-member-patch endpoint this user is also a member
 *                    of both groups so PATCH multi-member ops can be exercised
 *
 * GROUPS per endpoint (2):
 *   g1.multi       - members [u1, u2]      (multi-member PATCH testbed)
 *   g2.solo        - members [u3]          (single-member, deactivated user)
 *   (custom-ext-user has 0 groups - schema doesn't include Group resourceType)
 *
 * Idempotency:
 *   - Endpoints upserted by name.
 *   - Resources upserted by (endpointId, userName) for users and (endpointId, displayName)
 *     for groups. Re-running this script is safe and produces no duplicates.
 *
 * Inputs (env):
 *   DEV_DATABASE_URL  (or DATABASE_URL as fallback)  - target connection string
 *   DRY_RUN=1                                        - print plan without writing
 *
 * Run:
 *   $env:DEV_DATABASE_URL="postgresql://..."
 *   pnpm --filter ./api exec ts-node --transpile-only src/scripts/seed-shape-coverage.ts
 */
import { PrismaClient, Prisma } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';

import { validateAndExpandProfile } from '../modules/scim/endpoint-profile/endpoint-profile.service';
import {
  PRESET_RFC_STANDARD,
  PRESET_ENTRA_ID,
  PRESET_ENTRA_ID_MINIMAL,
  PRESET_USER_ONLY_WITH_CUSTOM_EXT,
  getBuiltInPreset,
} from '../modules/scim/endpoint-profile/built-in-presets';
import type {
  EndpointProfile,
  ShorthandProfileInput,
} from '../modules/scim/endpoint-profile/endpoint-profile.types';
import type {
  ScimSchemaAttribute,
  ScimResourceType,
} from '../modules/scim/discovery/scim-schema-registry';
import { ENDPOINT_CONFIG_FLAGS } from '../modules/endpoint/endpoint-config.interface';

// ─── Constants ──────────────────────────────────────────────────────────────

const TARGET_URL =
  process.env.DEV_DATABASE_URL ??
  process.env.DATABASE_URL ??
  '';
if (!TARGET_URL) {
  throw new Error('DEV_DATABASE_URL (or DATABASE_URL) must be set');
}
const DRY_RUN = process.env.DRY_RUN === '1';
const SHAPE_PREFIX = 'shape-';
const DEV_BCRYPT_COST = 4; // dev-only — fast bcrypt for fixture seeding

// Plain-text dev secret used for the per-endpoint-creds endpoint.
// Documented in docs/PROD_TO_DEV_MIRRORING_AND_FIXTURES.md.
const SHAPE_DEV_BEARER_PLAINTEXT = 'shape-dev-secret';

// ─── Profile builders ───────────────────────────────────────────────────────

interface ShapeDef {
  name: string;
  displayName: string;
  description: string;
  profile: EndpointProfile;
  hasGroups: boolean;
  hasCustomExtension: boolean;
  customExtUrn?: string;
  /** When true, also seed a per-endpoint bearer credential row. */
  perEndpointCreds?: boolean;
}

function expand(input: ShorthandProfileInput): EndpointProfile {
  const r = validateAndExpandProfile(input);
  if (!r.valid || !r.profile) {
    throw new Error(`Invalid synthetic profile: ${r.errors.map(e => e.detail).join('; ')}`);
  }
  return r.profile;
}

function buildShapes(): ShapeDef[] {
  const F = ENDPOINT_CONFIG_FLAGS;

  // 1) RFC strict
  const rfcStrict: EndpointProfile = expand({
    ...getBuiltInPreset(PRESET_RFC_STANDARD).profile,
    settings: {
      [F.STRICT_SCHEMA_VALIDATION]: true,
      [F.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: false,
      [F.REQUIRE_IF_MATCH]: true,
      [F.PRIMARY_ENFORCEMENT]: 'reject',
      [F.VERBOSE_PATCH_SUPPORTED]: true,
    },
  });

  // 2) Entra-lenient
  const entraLenient: EndpointProfile = expand({
    ...getBuiltInPreset(PRESET_ENTRA_ID).profile,
    settings: {
      [F.STRICT_SCHEMA_VALIDATION]: false,
      [F.ALLOW_AND_COERCE_BOOLEAN_STRINGS]: true,
      [F.IGNORE_READONLY_ATTRIBUTES_IN_PATCH]: true,
      [F.INCLUDE_WARNING_ABOUT_IGNORED_READONLY_ATTRIBUTE]: true,
      [F.VERBOSE_PATCH_SUPPORTED]: false,
      [F.PRIMARY_ENFORCEMENT]: 'normalize',
    },
  });

  // 3) Custom-extension user-only
  const customExtUser: EndpointProfile = expand({
    ...getBuiltInPreset(PRESET_USER_ONLY_WITH_CUSTOM_EXT).profile,
    settings: {
      [F.STRICT_SCHEMA_VALIDATION]: true,
      [F.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED]: false,
      [F.VERBOSE_PATCH_SUPPORTED]: true,
    },
  });
  const customExtUrn = pickCustomExtensionUrn(customExtUser);

  // 4) Soft-delete only
  const softDelete: EndpointProfile = expand({
    ...getBuiltInPreset(PRESET_ENTRA_ID_MINIMAL).profile,
    settings: {
      [F.USER_SOFT_DELETE_ENABLED]: true,
      [F.USER_HARD_DELETE_ENABLED]: false,
      [F.GROUP_HARD_DELETE_ENABLED]: false,
      [F.STRICT_SCHEMA_VALIDATION]: true,
    },
  });

  // 5) Per-endpoint creds
  const perEndpointCreds: EndpointProfile = expand({
    ...getBuiltInPreset(PRESET_ENTRA_ID).profile,
    settings: {
      [F.PER_ENDPOINT_CREDENTIALS_ENABLED]: true,
      [F.STRICT_SCHEMA_VALIDATION]: true,
    },
  });

  // 6) Custom resource type (Device) - inline custom profile
  const customResource = buildCustomResourceProfile();

  return [
    {
      name: `${SHAPE_PREFIX}rfc-strict`,
      displayName: 'Shape: RFC strict',
      description: 'rfc-standard preset, StrictSchemaValidation=on, RequireIfMatch=on, PrimaryEnforcement=reject',
      profile: rfcStrict,
      hasGroups: true,
      hasCustomExtension: false,
    },
    {
      name: `${SHAPE_PREFIX}entra-lenient`,
      displayName: 'Shape: Entra lenient',
      description: 'entra-id preset, lenient validation, boolean coercion, readOnly PATCH ignored',
      profile: entraLenient,
      hasGroups: true,
      hasCustomExtension: false,
    },
    {
      name: `${SHAPE_PREFIX}custom-ext-user`,
      displayName: 'Shape: Custom extension (user-only)',
      description: 'user-only-with-custom-ext preset; tests writeOnly + never returned attrs in extension',
      profile: customExtUser,
      hasGroups: false,
      hasCustomExtension: true,
      customExtUrn,
    },
    {
      name: `${SHAPE_PREFIX}soft-delete-only`,
      displayName: 'Shape: Soft-delete only',
      description: 'entra-id-minimal; hard delete disabled for both User and Group',
      profile: softDelete,
      hasGroups: true,
      hasCustomExtension: false,
    },
    {
      name: `${SHAPE_PREFIX}per-endpoint-creds`,
      displayName: 'Shape: Per-endpoint credentials',
      description: 'entra-id; per-endpoint bearer credential is seeded ("shape-dev-secret")',
      profile: perEndpointCreds,
      hasGroups: true,
      hasCustomExtension: false,
      perEndpointCreds: true,
    },
    {
      name: `${SHAPE_PREFIX}custom-resource`,
      displayName: 'Shape: Custom resource type (Device)',
      description: 'Inline custom profile: User + Group + custom Device resourceType with its own URN',
      profile: customResource,
      hasGroups: true,
      hasCustomExtension: true,
      customExtUrn: pickCustomExtensionUrn(customResource),
    },
  ];
}

function pickCustomExtensionUrn(profile: EndpointProfile): string | undefined {
  // First non-core / non-enterprise schema URN treated as the custom extension.
  for (const s of profile.schemas) {
    if (
      !s.id.endsWith(':User') &&
      !s.id.endsWith(':Group') &&
      !s.id.includes('extension:enterprise')
    ) {
      return s.id;
    }
  }
  return undefined;
}

function buildCustomResourceProfile(): EndpointProfile {
  // Start from rfc-standard so we have proper User + Group attribute lists, then
  // graft on a custom Device schema and custom extension on User.
  const base = getBuiltInPreset(PRESET_RFC_STANDARD).profile;
  const customExtUrn = 'urn:scimserver:devshapes:user:hr-extras:1.0';
  const deviceUrn = 'urn:scimserver:devshapes:device:1.0';

  const grafted: ShorthandProfileInput = {
    schemas: [
      ...(base.schemas ?? []),
      {
        id: customExtUrn,
        name: 'HRExtras',
        description: 'Custom HR-style extension attributes (synthetic)',
        attributes: [
          {
            name: 'employeeNumber', type: 'string', multiValued: false, required: false,
            caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none',
            description: 'Internal HR identifier',
          } as Partial<ScimSchemaAttribute>,
          {
            name: 'costCenter', type: 'string', multiValued: false, required: false,
            caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none',
            description: 'Cost center for billing',
          } as Partial<ScimSchemaAttribute>,
        ],
      },
      {
        id: deviceUrn,
        name: 'Device',
        description: 'Custom Device resource (synthetic)',
        attributes: [
          {
            name: 'serialNumber', type: 'string', multiValued: false, required: true,
            caseExact: true, mutability: 'immutable', returned: 'default', uniqueness: 'server',
            description: 'Device serial number (immutable, server-unique)',
          } as Partial<ScimSchemaAttribute>,
          {
            name: 'model', type: 'string', multiValued: false, required: false,
            caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none',
            description: 'Device model name',
          } as Partial<ScimSchemaAttribute>,
          {
            name: 'active', type: 'boolean', multiValued: false, required: false,
            caseExact: false, mutability: 'readWrite', returned: 'default', uniqueness: 'none',
            description: 'Whether the device is active',
          } as Partial<ScimSchemaAttribute>,
        ],
      },
    ],
    resourceTypes: [
      ...(base.resourceTypes ?? []),
      {
        id: 'Device',
        name: 'Device',
        endpoint: '/Devices',
        description: 'Custom Device resource',
        schema: deviceUrn,
        schemaExtensions: [],
      } as ScimResourceType,
    ],
    settings: {
      [ENDPOINT_CONFIG_FLAGS.STRICT_SCHEMA_VALIDATION]: true,
      [ENDPOINT_CONFIG_FLAGS.VERBOSE_PATCH_SUPPORTED]: true,
      [ENDPOINT_CONFIG_FLAGS.MULTI_MEMBER_PATCH_OP_FOR_GROUP_ENABLED]: true,
    },
  };

  // Bind the custom extension to User in the resourceTypes section.
  if (grafted.resourceTypes) {
    for (const rt of grafted.resourceTypes) {
      if (rt.name === 'User') {
        rt.schemaExtensions = [
          ...(rt.schemaExtensions ?? []),
          { schema: customExtUrn, required: false },
        ];
      }
    }
  }

  return expand(grafted);
}

// ─── Resource builders ──────────────────────────────────────────────────────

interface SeedUser {
  userName: string;
  externalId?: string;
  name?: { givenName?: string; familyName?: string };
  emails?: { value: string; type?: string; primary?: boolean }[];
  phoneNumbers?: { value: string; type?: string }[];
  active: boolean;
}

function usersFor(shape: ShapeDef): SeedUser[] {
  const ext = shape.customExtUrn;
  const u1: SeedUser = {
    userName: 'u1.minimal@shape.dev',
    active: true,
  };
  const u2: SeedUser = {
    userName: 'u2.rich@shape.dev',
    externalId: 'EXT-U2',
    name: { givenName: 'Rich', familyName: 'Shape' },
    emails: [
      { value: 'u2.primary@shape.dev', type: 'work', primary: true },
      { value: 'u2.alt@shape.dev', type: 'home', primary: false },
    ],
    phoneNumbers: [{ value: '+1-555-0102', type: 'work' }],
    active: true,
  };
  const u3: SeedUser = {
    userName: 'u3.edge@shape.dev',
    externalId: 'EXT-U3-DEACTIVATED',
    active: false,
  };
  return ext ? [u1, u2, u3] : [u1, u2, u3];
}

function userPayload(shape: ShapeDef, u: SeedUser, scimId: string): Prisma.JsonObject {
  const base: Prisma.JsonObject = {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: scimId,
    userName: u.userName,
    active: u.active,
  };
  if (u.externalId) base.externalId = u.externalId;
  if (u.name) base.name = u.name as unknown as Prisma.JsonObject;
  if (u.emails) base.emails = u.emails as unknown as Prisma.JsonArray;
  if (u.phoneNumbers) base.phoneNumbers = u.phoneNumbers as unknown as Prisma.JsonArray;
  if (shape.hasCustomExtension && shape.customExtUrn && u.userName.startsWith('u2.')) {
    base.schemas = [...(base.schemas as string[]), shape.customExtUrn];
    base[shape.customExtUrn] = {
      employeeNumber: 'E-1002',
      costCenter: 'CC-DEV',
    };
  }
  base.meta = { resourceType: 'User' };
  return base;
}

function groupPayload(displayName: string, scimId: string, members: { value: string; display?: string }[]): Prisma.JsonObject {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    id: scimId,
    displayName,
    members: members as unknown as Prisma.JsonArray,
    meta: { resourceType: 'Group' },
  };
}

// ─── Deterministic IDs ──────────────────────────────────────────────────────

/**
 * Produce a deterministic UUID v5-style identifier from a label so that
 * re-runs target the same row regardless of randomUUID() drift.
 * Uses SHA-256 truncated to 16 bytes formatted as a UUID.
 */
function deterministicUuid(label: string): string {
  const h = createHash('sha256').update(label).digest('hex');
  return [
    h.substring(0, 8),
    h.substring(8, 12),
    '5' + h.substring(13, 16),                  // force version nibble = 5
    ((parseInt(h.substring(16, 18), 16) & 0x3f) | 0x80).toString(16) + h.substring(18, 20),
    h.substring(20, 32),
  ].join('-');
}

// ─── Stats ──────────────────────────────────────────────────────────────────

const stats = {
  endpoints: { created: 0, updated: 0 },
  users:     { created: 0, updated: 0 },
  groups:    { created: 0, updated: 0 },
  members:   { created: 0 },
  creds:     { created: 0, skipped: 0 },
};

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  banner();
  const pool = new pg.Pool({ connectionString: TARGET_URL, max: 4 });
  const adapter = new PrismaPg(pool);
  const db = new PrismaClient({ adapter, log: ['warn', 'error'] });

  try {
    await db.$connect();
    log('Connected to target database.');

    const shapes = buildShapes();
    log(`Planning ${shapes.length} shape endpoints…`);

    for (const shape of shapes) {
      const ep = await upsertEndpoint(db, shape);
      log(`endpoint ${shape.name} → ${ep.id}`);
      const seedUsers = usersFor(shape);
      const userResources: { id: string; userName: string; displayName: string }[] = [];

      for (const u of seedUsers) {
        const r = await upsertUser(db, ep.id, shape, u);
        userResources.push({ id: r.id, userName: u.userName, displayName: u.name ? `${u.name.givenName ?? ''} ${u.name.familyName ?? ''}`.trim() : u.userName });
      }

      if (shape.hasGroups) {
        await upsertGroup(db, ep.id, 'g1.multi', [userResources[0], userResources[1]]);
        await upsertGroup(db, ep.id, 'g2.solo', [userResources[2]]);
      }

      if (shape.perEndpointCreds) {
        await upsertEndpointCredential(db, ep.id);
      }
    }

    summary();
  } finally {
    await db.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

// ─── Upserts ────────────────────────────────────────────────────────────────

async function upsertEndpoint(
  db: PrismaClient,
  shape: ShapeDef,
): Promise<{ id: string }> {
  const existing = await db.endpoint.findUnique({ where: { name: shape.name }, select: { id: true } });
  if (existing) {
    if (!DRY_RUN) {
      await db.endpoint.update({
        where: { id: existing.id },
        data: {
          displayName: shape.displayName,
          description: shape.description,
          profile: shape.profile as unknown as Prisma.InputJsonValue,
          active: true,
        },
      });
    }
    stats.endpoints.updated++;
    return { id: existing.id };
  }
  const id = deterministicUuid(`endpoint:${shape.name}`);
  if (DRY_RUN) {
    stats.endpoints.created++;
    return { id };
  }
  const created = await db.endpoint.create({
    data: {
      id,
      name: shape.name,
      displayName: shape.displayName,
      description: shape.description,
      profile: shape.profile as unknown as Prisma.InputJsonValue,
      active: true,
    },
    select: { id: true },
  });
  stats.endpoints.created++;
  return created;
}

async function upsertUser(
  db: PrismaClient,
  endpointId: string,
  shape: ShapeDef,
  u: SeedUser,
): Promise<{ id: string; scimId: string }> {
  const existing = await db.scimResource.findUnique({
    where: { endpointId_userName: { endpointId, userName: u.userName } },
    select: { id: true, scimId: true },
  });
  if (existing) {
    if (!DRY_RUN) {
      const payload = userPayload(shape, u, existing.scimId);
      await db.scimResource.update({
        where: { id: existing.id },
        data: {
          externalId: u.externalId ?? null,
          displayName: u.name ? `${u.name.givenName ?? ''} ${u.name.familyName ?? ''}`.trim() || null : null,
          active: u.active,
          payload: payload as unknown as Prisma.InputJsonValue,
        },
      });
    }
    stats.users.updated++;
    return { id: existing.id, scimId: existing.scimId };
  }
  const rowId = deterministicUuid(`user:${endpointId}:${u.userName}`);
  const scimId = deterministicUuid(`user-scim:${endpointId}:${u.userName}`);
  const displayName = u.name ? `${u.name.givenName ?? ''} ${u.name.familyName ?? ''}`.trim() || null : null;
  if (DRY_RUN) {
    stats.users.created++;
    return { id: rowId, scimId };
  }
  await db.scimResource.create({
    data: {
      id: rowId,
      endpointId,
      resourceType: 'User',
      scimId,
      externalId: u.externalId ?? null,
      userName: u.userName,
      displayName,
      active: u.active,
      payload: userPayload(shape, u, scimId) as unknown as Prisma.InputJsonValue,
      version: 1,
    },
  });
  stats.users.created++;
  return { id: rowId, scimId };
}

async function upsertGroup(
  db: PrismaClient,
  endpointId: string,
  shortName: string,
  members: { id: string; userName: string; displayName: string }[],
): Promise<void> {
  const displayName = `Shape Group ${shortName}`;
  // Group displayName uniqueness is enforced at service level only; we use our
  // own (endpointId, displayName) lookup to find the existing fixture.
  const existing = await db.scimResource.findFirst({
    where: { endpointId, resourceType: 'Group', displayName },
    select: { id: true, scimId: true },
  });
  const memberValues = members.map(m => ({ value: m.id, display: m.displayName || m.userName }));
  if (existing) {
    if (!DRY_RUN) {
      const payload = groupPayload(displayName, existing.scimId, memberValues);
      await db.scimResource.update({
        where: { id: existing.id },
        data: { payload: payload as unknown as Prisma.InputJsonValue },
      });
      // Replace member rows: delete then re-insert (small N, simplest correct path).
      await db.resourceMember.deleteMany({ where: { groupResourceId: existing.id } });
      for (const m of members) {
        await db.resourceMember.create({
          data: {
            groupResourceId: existing.id,
            memberResourceId: m.id,
            value: m.id,
            display: m.displayName || m.userName,
            type: 'User',
          },
        });
        stats.members.created++;
      }
    }
    stats.groups.updated++;
    return;
  }
  const groupRowId = deterministicUuid(`group:${endpointId}:${shortName}`);
  const groupScimId = deterministicUuid(`group-scim:${endpointId}:${shortName}`);
  if (DRY_RUN) {
    stats.groups.created++;
    return;
  }
  await db.scimResource.create({
    data: {
      id: groupRowId,
      endpointId,
      resourceType: 'Group',
      scimId: groupScimId,
      displayName,
      payload: groupPayload(displayName, groupScimId, memberValues) as unknown as Prisma.InputJsonValue,
      version: 1,
    },
  });
  for (const m of members) {
    await db.resourceMember.create({
      data: {
        groupResourceId: groupRowId,
        memberResourceId: m.id,
        value: m.id,
        display: m.displayName || m.userName,
        type: 'User',
      },
    });
    stats.members.created++;
  }
  stats.groups.created++;
}

async function upsertEndpointCredential(db: PrismaClient, endpointId: string): Promise<void> {
  const label = 'shape-dev-bearer';
  const existing = await db.endpointCredential.findFirst({
    where: { endpointId, label },
    select: { id: true },
  });
  if (existing) {
    stats.creds.skipped++;
    return;
  }
  if (DRY_RUN) {
    stats.creds.created++;
    return;
  }
  const hash = await bcrypt.hash(SHAPE_DEV_BEARER_PLAINTEXT, DEV_BCRYPT_COST);
  await db.endpointCredential.create({
    data: {
      id: deterministicUuid(`cred:${endpointId}:${label}`),
      endpointId,
      credentialType: 'bearer',
      credentialHash: hash,
      label,
      active: true,
    },
  });
  stats.creds.created++;
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function banner(): void {
  log('=================================================================');
  log(' SCIMServer dev shape-coverage seed');
  log(`   target      : ${maskUrl(TARGET_URL)}`);
  log(`   prefix      : ${SHAPE_PREFIX}`);
  log(`   dry run     : ${DRY_RUN}`);
  log('=================================================================');
}
function summary(): void {
  log('-----------------------------------------------------------------');
  log(' SUMMARY');
  log(`   endpoints   : created=${stats.endpoints.created} updated=${stats.endpoints.updated}`);
  log(`   users       : created=${stats.users.created} updated=${stats.users.updated}`);
  log(`   groups      : created=${stats.groups.created} updated=${stats.groups.updated}`);
  log(`   memberships : created=${stats.members.created}`);
  log(`   credentials : created=${stats.creds.created} skipped=${stats.creds.skipped}`);
  log('-----------------------------------------------------------------');
  log('Note: per-endpoint bearer for shape-per-endpoint-creds = "shape-dev-secret"');
}
function maskUrl(u: string): string {
  return u.replace(/\/\/([^:]+):([^@]+)@/, '//$1:****@');
}
function log(msg: string): void {
  console.log(`[shape-seed] ${msg}`);
}

main().catch((err: unknown) => {
  console.error('[shape-seed] FATAL', err);
  process.exit(1);
});
