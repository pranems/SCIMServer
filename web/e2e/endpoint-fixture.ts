/**
 * endpoint-fixture.ts - shared, self-cleaning endpoint fixtures for Playwright.
 *
 * WHY THIS EXISTS (2026-08-05)
 * ---------------------------------------------------------------------------
 * Many specs used to open "the first endpoint card" and then `test.skip(...)`
 * when that endpoint happened to lack whatever the test needed (a credential, a
 * WIF method, any users at all). Three separate defects came out of that shape:
 *
 *  1. DEAD TESTS. `test.skip((await cards.count()) === 0, 'Tenant has zero
 *     endpoints.')` never fired for the right reason - `.count()` does NOT
 *     auto-wait, so on a SPA it read 0 before React painted and skipped while
 *     dev was serving 58+ endpoints. Eight specs were silently skipping every
 *     run against a fully-populated environment.
 *
 *  2. NON-DETERMINISM. "Whichever endpoint sorts first" is not a property any
 *     environment guarantees. A test that only asserts when the first endpoint
 *     happens to be configured a certain way asserts nothing the rest of the
 *     time.
 *
 *  3. CROSS-SPEC INTERFERENCE. The admin list is ordered `createdAt DESC`, so
 *     any endpoint a spec creates immediately BECOMES "the first endpoint" for
 *     every other spec running in parallel - and is then deleted underneath
 *     them at cleanup. This is why specs that pick the first card intermittently
 *     time out during a full parallel run.
 *
 * The fix for all three is the same: a spec that needs an endpoint in a
 * particular shape CREATES one in that shape, asserts against it, and deletes
 * it. Preconditions then hold by construction, so the assertions are real and
 * no spec depends on ambient tenant state.
 *
 * USAGE
 *   import { createFixtureEndpoint, deleteFixtureEndpoint } from './endpoint-fixture';
 *
 *   let epId: string | null = null;
 *   test.afterEach(async ({ page }) => { epId = await deleteFixtureEndpoint(page, epId); });
 *
 *   test('...', async ({ page }) => {
 *     epId = await createFixtureEndpoint(page, { settings: { WifCredentialsEnabled: true } });
 *     await page.goto(`/endpoints/${epId}/settings`);
 *   });
 */
import { expect, type Page } from '@playwright/test';

export const TOKEN_STORAGE_KEY = 'scimserver.authToken';
export const E2E_TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

/**
 * Endpoint config flags that gate the per-method credential tabs. Mirrors
 * `enabledMethodTabs()` in web/src/pages/CredentialsTab.tsx - keep in sync.
 * Defaults there: shared_secret on, everything else off.
 */
export const METHOD_FLAGS = {
  bearer: 'SecretTokenBearerAuthEnabled',
  oauthClient: 'OAuthClientCredentialsAuthEnabled',
  wif: 'WifCredentialsEnabled',
  sharedSecret: 'SharedSecretBearerAuthEnabled',
} as const;

export interface FixtureEndpointOptions {
  /** Prefix for the generated endpoint name, to make ownership obvious on dev. */
  namePrefix?: string;
  /** Profile preset to create the endpoint with. */
  profilePreset?: string;
  /** Endpoint settings to PATCH on after create (e.g. method-enabling flags). */
  settings?: Record<string, unknown>;
  /** Credential types to seed, in order. */
  credentials?: Array<'bearer' | 'oauth_client' | 'wif'>;
  /** Number of SCIM users to seed into the endpoint. */
  users?: number;
}

/**
 * Users seeded by the most recent {@link createFixtureEndpoint} call, so the
 * common single-endpoint helper can keep returning a plain id while
 * {@link createFixtureEndpointWithUsers} can still hand back the seeded rows.
 */
let lastSeededUsers: Array<{ id: string; userName: string }> = [];

/**
 * Seed the auth token before any page script runs. Without this the app renders
 * its "Authentication Required" dialog and every locator times out.
 */
export async function seedAuthToken(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: E2E_TOKEN },
  );
}

/**
 * Create an endpoint configured exactly as the caller needs, via the admin API
 * from inside the page origin (so it shares the app's cookies/origin).
 *
 * Returns the new endpoint id. Fails the test if creation did not succeed -
 * deliberately an assertion, not a skip: an admin API that cannot create an
 * endpoint is a real problem, not a reason to pass silently.
 */
export async function createFixtureEndpoint(
  page: Page,
  options: FixtureEndpointOptions = {},
): Promise<string> {
  const {
    namePrefix = 'e2e-fixture',
    profilePreset = 'rfc-standard',
    settings,
    credentials = [],
    users = 0,
  } = options;

  // The admin calls run same-origin, so the page must already be on the app.
  if (!page.url().startsWith('http')) {
    await page.goto('/endpoints');
  }

  const result = await page.evaluate(
    async ({ t, prefix, preset, sets, creds, userCount }) => {
      const json = (extra: Record<string, string> = {}) => ({
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
        ...extra,
      });

      const created = await fetch('/scim/admin/endpoints', {
        method: 'POST',
        headers: json(),
        body: JSON.stringify({
          name: `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          profilePreset: preset,
        }),
      });
      if (!created.ok) {
        return { id: null, users: [], error: `create failed ${created.status}: ${await created.text()}` };
      }
      const ep = (await created.json()) as { id?: string };
      if (!ep?.id) return { id: null, users: [], error: 'create returned no id' };

      const seededUsers: Array<{ id: string; userName: string }> = [];

      if (sets && Object.keys(sets).length > 0) {
        const patched = await fetch(`/scim/admin/endpoints/${ep.id}`, {
          method: 'PATCH',
          headers: json(),
          body: JSON.stringify({ profile: { settings: sets } }),
        });
        if (!patched.ok) {
          return { id: ep.id, users: [], error: `settings PATCH failed ${patched.status}: ${await patched.text()}` };
        }
      }

      for (const credentialType of creds) {
        const c = await fetch(`/scim/admin/endpoints/${ep.id}/credentials`, {
          method: 'POST',
          headers: json(),
          body: JSON.stringify({ credentialType, label: `${prefix}-cred` }),
        });
        if (!c.ok) {
          return { id: ep.id, users: [], error: `credential ${credentialType} failed ${c.status}: ${await c.text()}` };
        }
      }

      for (let i = 0; i < userCount; i++) {
        // Deliberately Entra-shaped and LONG (>= 40 chars) so truncation specs
        // have something that actually overflows, and enriched with
        // name/emails/externalId/enterprise so the "Additional attributes"
        // drawer section has content. Both used to be hunted for among ambient
        // tenant data, which made those specs skip on a tenant that happened
        // to hold only short, bare users.
        const userName = `${prefix}-fixture-user-${i}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@contoso-fixture.example.com`;
        const u = await fetch(`/scim/endpoints/${ep.id}/Users`, {
          method: 'POST',
          headers: json({ 'Content-Type': 'application/scim+json' }),
          body: JSON.stringify({
            schemas: [
              'urn:ietf:params:scim:schemas:core:2.0:User',
              'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
            ],
            userName,
            externalId: `ext-${i}-${Date.now()}`,
            name: { givenName: 'Fixture', familyName: `User${i}`, formatted: `Fixture User${i}` },
            displayName: `Fixture User${i}`,
            emails: [{ value: userName, type: 'work', primary: true }],
            'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
              department: 'E2E',
              employeeNumber: `E${i}`,
            },
            active: true,
          }),
        });
        if (!u.ok) {
          return { id: ep.id, users: [], error: `user ${i} failed ${u.status}: ${await u.text()}` };
        }
        const created = (await u.json()) as { id?: string; userName?: string };
        seededUsers.push({ id: created.id ?? '', userName: created.userName ?? userName });
      }

      return { id: ep.id, users: seededUsers, error: null as string | null };
    },
    {
      t: E2E_TOKEN,
      prefix: namePrefix,
      preset: profilePreset,
      sets: settings ?? null,
      creds: credentials,
      userCount: users,
    },
  );

  expect(result.error, `fixture endpoint setup must succeed (${result.error ?? ''})`).toBeNull();
  expect(result.id, 'fixture endpoint must be creatable via the admin API').toBeTruthy();
  lastSeededUsers = result.users ?? [];
  return result.id as string;
}

export interface FixtureUser {
  id: string;
  userName: string;
}

/**
 * Same as {@link createFixtureEndpoint} but also returns the seeded users, for
 * specs that need to address a specific user row (truncation, drawers, export).
 *
 * Seeded users are deliberately Entra-shaped: a >= 40-char userName so
 * truncation actually overflows, plus name/emails/externalId/enterprise so the
 * "Additional attributes" section has content.
 */
export async function createFixtureEndpointWithUsers(
  page: Page,
  options: FixtureEndpointOptions & { users: number },
): Promise<{ endpointId: string; users: FixtureUser[] }> {
  const endpointId = await createFixtureEndpoint(page, options);
  const users = lastSeededUsers;
  expect(users.length, 'fixture must seed the requested users').toBe(options.users);
  for (const u of users) {
    expect(u.id, 'each seeded user must have an id').toBeTruthy();
  }
  return { endpointId, users };
}

/**
 * Delete a fixture endpoint. Safe to call with null, and never throws - cleanup
 * must not mask the real assertion failure that may have preceded it.
 *
 * Returns null so callers can write `epId = await deleteFixtureEndpoint(page, epId)`.
 */
export async function deleteFixtureEndpoint(page: Page, id: string | null): Promise<null> {
  if (!id) return null;
  await page
    .evaluate(
      async ({ t, epId }: { t: string; epId: string }) => {
        await fetch(`/scim/admin/endpoints/${epId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${t}` },
        });
      },
      { t: E2E_TOKEN, epId: id },
    )
    .catch(() => undefined);
  return null;
}

/** Navigate to a fixture endpoint's credentials tab and select a method sub-tab. */
export async function openCredentialsTab(
  page: Page,
  endpointId: string,
  methodTab?: 'bearer' | 'oauth_client' | 'wif' | 'shared_secret',
): Promise<void> {
  await page.goto(`/endpoints/${endpointId}/credentials`);
  await expect(page.getByTestId('tab-credentials')).toBeVisible({ timeout: 30_000 });
  if (!methodTab) return;
  const tab = page.getByTestId(`credentials-method-tab-${methodTab}`);
  await expect(tab, `the ${methodTab} method tab must be enabled on this fixture`).toBeVisible({
    timeout: 15_000,
  });
  await tab.click();
}
