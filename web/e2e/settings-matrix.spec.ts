/**
 * settings-matrix.spec.ts - exhaustive browser coverage of the endpoint
 * configuration surface.
 *
 * WHY THIS EXISTS
 *   A 2026-07-31 audit of the settings surface against the Playwright suite
 *   found that **2 of 28 configuration flags had behavioural browser coverage**
 *   (RfcCompliantSubAttributes and CustomResourceTypesEnabled). One more
 *   (CredentialSecretVisibility) had a spec whose own comment concedes it is
 *   "READ-ONLY ... It does NOT click a different radio" - i.e. a presence-only
 *   assertion, which rule R10 says is not correctness. The remaining 25 flags,
 *   both enum dropdowns and all four numeric inputs, were never driven by a
 *   browser at all.
 *
 *   That is the dangerous shape: every one of those controls renders, so a
 *   human glance and a presence assertion both pass, while a control wired to
 *   nothing would ship unnoticed.
 *
 * WHAT "EXHAUSTIVE" MEANS HERE, PRECISELY
 *   28 booleans is 2^28 states - enumerating them is not a test strategy, it is
 *   a way to never finish. Exhaustive is therefore defined over the SURFACE,
 *   not the cartesian product:
 *     1. EVERY control the Settings tab renders is driven in a real browser
 *        and its persisted value is read back from the admin API. Nothing is
 *        asserted by presence.
 *     2. Every flag whose SCIM consequence is unambiguous also gets a
 *        behavioural assertion - the server's real accept/reject decision in
 *        both states, on a payload that only that flag governs.
 *     3. Every preset is instantiated and its published contract measured,
 *        because presets ARE flag combinations and differ from each other.
 *
 * DESIGN NOTES
 *   - The control list is derived at runtime from what the page actually
 *     renders (`settings-flag-*` testids), not from a hardcoded list. A
 *     hardcoded list silently stops covering a flag the day someone adds one;
 *     this way a new flag is covered the moment it appears, and the count
 *     assertion below fails loudly if the surface shrinks unexpectedly.
 *   - Every test creates its own throwaway endpoint and deletes it in a
 *     finally block, so this is safe against the shared dev estate.
 *
 * Runs against local dev (:4000), Docker compose (:8080) and Azure dev.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const CORE_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';

/** Lower bound on the rendered control count. Fails loudly if the surface shrinks. */
const MIN_EXPECTED_FLAGS = 20;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function createEndpoint(page: Page, preset = 'rfc-standard', tag = 'matrix'): Promise<string | null> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });
  return page.evaluate(
    async ({ token, preset, tag }: { token: string; preset: string; tag: string }) => {
      const res = await fetch('/scim/admin/endpoints', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
          profilePreset: preset,
        }),
      });
      if (!res.ok) return null;
      return (await res.json()).id as string;
    },
    { token: TOKEN, preset, tag },
  );
}

async function deleteEndpoint(page: Page, id: string | null): Promise<void> {
  if (!id) return;
  await page.evaluate(
    async ({ token, id }: { token: string; id: string }) => {
      await fetch(`/scim/admin/endpoints/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    },
    { token: TOKEN, id },
  );
}

/** The endpoint's own view of its settings, straight from the admin API. */
async function readSettings(page: Page, id: string): Promise<Record<string, unknown>> {
  return page.evaluate(
    async ({ token, id }: { token: string; id: string }) => {
      const res = await fetch(`/scim/admin/endpoints/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return {};
      const body = await res.json();
      return (body.profile?.settings ?? {}) as Record<string, unknown>;
    },
    { token: TOKEN, id },
  );
}

/** Normalises the several truthy spellings the API accepts ("True"/true/"true"). */
function asBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return undefined;
}

async function openSettings(page: Page, id: string): Promise<void> {
  await page.goto(`/endpoints/${id}/settings`);
  await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });
}

/** Clicks a flag Switch and waits for the page's own save confirmation. */
async function toggleFlag(page: Page, key: string): Promise<void> {
  const sw = page.getByTestId(`settings-flag-${key}`);
  await expect(sw).toBeVisible({ timeout: 15_000 });
  await sw.click();
  await expect(page.getByTestId('settings-feedback-success')).toBeVisible({ timeout: 20_000 });
}

/**
 * Writes a setting straight through the admin API.
 *
 * Used to RESTORE state after a UI toggle. Restoring through the UI looks
 * tidier but is unsafe here: several flags govern authentication, and the
 * 2026-07-31 first run of this spec proved the hazard - toggling one of them
 * off dropped the browser session and the app raised its "Authentication
 * Required" dialog, after which every later flag in the loop failed for a
 * reason that had nothing to do with that flag. Restoring out-of-band keeps
 * one flag's blast radius from contaminating the next one's result.
 */
async function setSettingViaApi(page: Page, id: string, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    async (a: { token: string; id: string; key: string; value: unknown }) => {
      await fetch(`/scim/admin/endpoints/${a.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { settings: { [a.key]: a.value } } }),
      });
    },
    { token: TOKEN, id, key, value },
  );
}

/** Re-seeds the token and reloads, recovering from an auth dialog. */
async function reauth(page: Page): Promise<void> {
  await page.evaluate(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
}

/** The label a settings Dropdown is currently displaying. */
async function dropdownDisplay(page: Page, key: string): Promise<string> {
  const root = page.getByTestId(`settings-enum-${key}-dropdown`);
  await expect(root).toBeVisible({ timeout: 15_000 });
  const combo = root.locator('[role="combobox"]');
  const target = (await combo.count()) > 0 ? combo.first() : root;
  return (await target.innerText()) || '';
}

/**
 * The effective on/off state a flag Switch is currently rendering.
 *
 * This is the honest source for "what was it before I clicked?", because a
 * flag the preset never wrote is simply absent from the settings object - the
 * API says `undefined` while the UI correctly shows the inherited default.
 */
async function switchChecked(page: Page, key: string): Promise<boolean> {
  const root = page.getByTestId(`settings-flag-${key}`);
  await expect(root).toBeVisible({ timeout: 15_000 });
  const box = root.locator('input[type="checkbox"]');
  const target = (await box.count()) > 0 ? box.first() : root;
  return target.isChecked();
}

/** A raw SCIM call as the server sees it, returning status + body. */
async function scim(
  page: Page,
  id: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async (a: { token: string; id: string; method: string; path: string; body?: unknown; headers: Record<string, string> }) => {
      const res = await fetch(`/scim/v2/endpoints/${a.id}${a.path}`, {
        method: a.method,
        headers: {
          Authorization: `Bearer ${a.token}`,
          'Content-Type': 'application/scim+json',
          ...a.headers,
        },
        body: a.body === undefined ? undefined : JSON.stringify(a.body),
      });
      let parsed: Record<string, unknown> = {};
      try {
        parsed = (await res.json()) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      return { status: res.status, body: parsed };
    },
    { token: TOKEN, id, method, path, body, headers },
  );
}

// ---------------------------------------------------------------------------
// 1. EVERY rendered control round-trips through the real browser
// ---------------------------------------------------------------------------

test.describe('Settings matrix - every control is driven in a real browser', () => {
  test('every boolean flag toggles in the UI and the new value is persisted server-side', async ({ page }) => {
    test.setTimeout(15 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'flagmatrix');
      test.skip(!id, 'Could not create the fixture endpoint.');
      await openSettings(page, id!);

      // Derive the control list from the DOM, so a newly added flag is covered
      // automatically instead of silently escaping a hardcoded list.
      //
      // The `!includes('-')` filter is load-bearing: the row and description
      // wrappers (`settings-flag-row-X`, `settings-flag-desc-X`) share the same
      // testid prefix as the Switch, and a flag key never contains a hyphen.
      // Without it the scrape invents keys like `row-StrictSchemaValidation`.
      const keys = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="settings-flag-"]'))
          .map((el) => (el.getAttribute('data-testid') || '').replace('settings-flag-', ''))
          .filter((k) => k && !k.includes('-')),
      );

      expect(keys.length, 'the Settings tab should render the full flag surface').toBeGreaterThanOrEqual(MIN_EXPECTED_FLAGS);

      const failures: string[] = [];
      const covered: string[] = [];
      for (const key of keys) {
        await openSettings(page, id!);

        // Take the BEFORE value from the Switch itself, not from the API.
        // A flag the preset never wrote is absent from the settings object, so
        // the API reports `undefined` while the Switch correctly renders the
        // effective default. Reading the API here was the bug that made the
        // first dev run cascade: `before` came back undefined for
        // SharedSecretBearerAuthEnabled, the guarded restore was skipped, the
        // endpoint was left with its auth off, and all 18 later flags failed
        // against a dead session. The Switch is always defined.
        const before = await switchChecked(page, key);

        // Click, then wait on the SERVER, not on the confirmation banner.
        // Some flags govern authentication, and disabling one makes the SCIM
        // plane return 401, which the web client mistakes for an expired admin
        // session and replaces the page with its auth dialog before the
        // MessageBar can paint. Polling the persisted value measures what the
        // Switch actually did and is immune to that defect.
        await page.getByTestId(`settings-flag-${key}`).click();

        let after: boolean | undefined;
        for (let i = 0; i < 20; i++) {
          after = asBool((await readSettings(page, id!))[key]);
          if (after === !before) break;
          await page.waitForTimeout(500);
        }

        if (after === undefined) {
          failures.push(`${key}: nothing was persisted after the Switch was clicked`);
        } else if (after === before) {
          failures.push(`${key}: persisted value never changed (still ${String(before)})`);
        } else {
          covered.push(key);
        }

        // ALWAYS restore, unconditionally, out-of-band.
        await setSettingViaApi(page, id!, key, before);
        await reauth(page);
      }

      expect(failures, `flags whose UI toggle did not persist:\n${failures.join('\n')}`).toHaveLength(0);
      // eslint-disable-next-line no-console
      console.log(`[settings-matrix] round-tripped ${covered.length}/${keys.length} boolean flags through the browser`);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('both enum dropdowns persist every one of their selectable values', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'enummatrix');
      test.skip(!id, 'Could not create the fixture endpoint.');
      await openSettings(page, id!);

      // `settings-enum-{key}` is only the ROW wrapper; the Dropdown carries
      // `settings-enum-{key}-dropdown`. Scrape the dropdowns and strip the
      // suffix so the key matches the persisted setting name.
      const enums = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="settings-enum-"][data-testid$="-dropdown"]'))
          .map((el) => (el.getAttribute('data-testid') || '').replace('settings-enum-', '').replace(/-dropdown$/, ''))
          .filter(Boolean),
      );
      expect(enums.length, 'expected PrimaryEnforcement and logLevel dropdowns').toBeGreaterThanOrEqual(2);

      const failures: string[] = [];
      for (const key of enums) {
        await openSettings(page, id!);
        const dd = page.getByTestId(`settings-enum-${key}-dropdown`);
        await expect(dd).toBeVisible({ timeout: 15_000 });

        // Read the option set the UI actually offers rather than assuming it.
        await dd.click();
        const options = (await page.getByRole('option').allTextContents()).map((o) => o.trim()).filter(Boolean);
        await page.keyboard.press('Escape');
        expect(options.length, `${key} should offer selectable options`).toBeGreaterThan(0);

        // The dropdown DISPLAYS a human label ("passthrough (accept as-is)")
        // but PERSISTS a keyword ("passthrough"), so comparing the two
        // directly is wrong. Assert the properties that actually matter:
        // every option persists a non-empty value, each option maps to a
        // DISTINCT value, and the choice survives a reload in the UI.
        const persistedValues: string[] = [];
        for (const opt of options) {
          await openSettings(page, id!);
          await page.getByTestId(`settings-enum-${key}-dropdown`).click();
          const item = page.getByRole('option', { name: opt, exact: true });
          if ((await item.count()) === 0) continue;
          await item.click();
          await expect(page.getByTestId('settings-feedback-success')).toBeVisible({ timeout: 20_000 });

          const persisted = String((await readSettings(page, id!))[key] ?? '');
          if (!persisted) {
            failures.push(`${key}: selected "${opt}" but nothing was persisted`);
            continue;
          }
          persistedValues.push(persisted);

          // Round-trip through a reload: the UI must render the choice back.
          // Fluent's Dropdown trigger is a <button role="combobox">, not an
          // <input>, so the selected label is its TEXT - inputValue() throws
          // "Node is not an <input>" here.
          await openSettings(page, id!);
          const shown = (await dropdownDisplay(page, key)).trim();
          if (shown !== opt) {
            failures.push(`${key}: persisted "${persisted}" but the UI re-rendered "${shown}" instead of "${opt}"`);
          }
        }

        const distinct = new Set(persistedValues);
        if (distinct.size !== persistedValues.length) {
          failures.push(`${key}: options collapsed onto duplicate values [${persistedValues.join(', ')}]`);
        }
      }
      expect(failures, `enum values that did not persist:\n${failures.join('\n')}`).toHaveLength(0);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('all four numeric JWKS inputs persist a typed value', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'nummatrix');
      test.skip(!id, 'Could not create the fixture endpoint.');
      await openSettings(page, id!);

      // As with the enums, `settings-number-{key}` is the row wrapper and the
      // real field is `settings-number-{key}-input`.
      const nums = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="settings-number-"][data-testid$="-input"]'))
          .map((el) => (el.getAttribute('data-testid') || '').replace('settings-number-', '').replace(/-input$/, ''))
          .filter(Boolean),
      );
      expect(nums.length, 'expected the four JWKS numeric knobs').toBeGreaterThanOrEqual(4);

      // In-bounds values chosen per the documented ranges.
      const value: Record<string, string> = {
        JwksFetchTimeoutMs: '7500',
        JwksFetchRetries: '3',
        JwksFetchRetryBackoffMs: '350',
        JwksCacheMaxAgeMs: '900000',
      };

      const failures: string[] = [];
      for (const key of nums) {
        const v = value[key] ?? '1000';
        await openSettings(page, id!);
        // Unlike the Dropdown, this testid is on the <input> ITSELF, so it is
        // filled directly - descending into it finds nothing.
        const input = page.getByTestId(`settings-number-${key}-input`);
        await input.fill(v);
        // The field saves on blur, so focus must genuinely leave it.
        await input.blur();
        await expect(page.getByTestId('settings-feedback-success')).toBeVisible({ timeout: 20_000 });

        const persisted = String((await readSettings(page, id!))[key] ?? '');
        if (persisted !== v) failures.push(`${key}: typed ${v} but server persisted "${persisted}"`);
      }
      expect(failures, `numeric settings that did not persist:\n${failures.join('\n')}`).toHaveLength(0);
    } finally {
      await deleteEndpoint(page, id);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Behavioural consequence - the server's real decision in BOTH states
// ---------------------------------------------------------------------------

test.describe('Settings matrix - flags change real SCIM behaviour', () => {
  test('SchemaDiscoveryEnabled governs whether /Schemas is served', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'discovery');
      test.skip(!id, 'Could not create the fixture endpoint.');

      const on = await scim(page, id!, 'GET', '/Schemas');
      expect(on.status, 'discovery ON should serve /Schemas').toBe(200);

      await openSettings(page, id!);
      await toggleFlag(page, 'SchemaDiscoveryEnabled');

      const off = await scim(page, id!, 'GET', '/Schemas');
      expect(off.status, 'discovery OFF should NOT serve /Schemas as 200').not.toBe(200);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('RequireIfMatch governs whether a bare PUT is refused', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'ifmatch');
      test.skip(!id, 'Could not create the fixture endpoint.');

      const un = `ifmatch.${Date.now()}@example.com`;
      const created = await scim(page, id!, 'POST', '/Users', { schemas: [CORE_USER], userName: un, active: true });
      expect(created.status).toBe(201);
      const uid = created.body.id as string;

      const before = await scim(page, id!, 'PUT', `/Users/${uid}`, { schemas: [CORE_USER], userName: un, active: true });
      expect(before.status, 'with the flag OFF a bare PUT should be accepted').toBeLessThan(400);

      await openSettings(page, id!);
      await toggleFlag(page, 'RequireIfMatch');

      const after = await scim(page, id!, 'PUT', `/Users/${uid}`, { schemas: [CORE_USER], userName: un, active: true });
      expect(after.status, 'with the flag ON a PUT lacking If-Match should be refused with 428').toBe(428);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('StrictSchemaValidation governs whether an undeclared attribute is rejected', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'strict');
      test.skip(!id, 'Could not create the fixture endpoint.');

      const payload = (u: string) => ({ schemas: [CORE_USER], userName: u, active: true, totallyUndeclared: 'x' });

      const strictOn = await scim(page, id!, 'POST', '/Users', payload(`strict.on.${Date.now()}@example.com`));
      expect(strictOn.status, 'rfc-standard ships strict ON, so an undeclared attribute is rejected').toBe(400);

      await openSettings(page, id!);
      await toggleFlag(page, 'StrictSchemaValidation');

      const strictOff = await scim(page, id!, 'POST', '/Users', payload(`strict.off.${Date.now()}@example.com`));
      expect(strictOff.status, 'with strict OFF the same payload is accepted').toBe(201);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('AllowAndCoerceBooleanStrings governs whether active:"True" is coerced', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'coerce');
      test.skip(!id, 'Could not create the fixture endpoint.');

      // rfc-standard ships coercion OFF, so the string form is a type error.
      const off = await scim(page, id!, 'POST', '/Users', {
        schemas: [CORE_USER], userName: `coerce.off.${Date.now()}@example.com`, active: 'True',
      });

      await openSettings(page, id!);
      await toggleFlag(page, 'AllowAndCoerceBooleanStrings');

      const on = await scim(page, id!, 'POST', '/Users', {
        schemas: [CORE_USER], userName: `coerce.on.${Date.now()}@example.com`, active: 'True',
      });

      // Assert the DIFFERENCE the flag makes, and that ON yields a real boolean.
      expect(
        { off: off.status, on: on.status },
        'flipping the flag should change the accept/reject decision for active:"True"',
      ).not.toEqual({ off: on.status, on: on.status });
      if (on.status === 201) {
        expect(on.body.active, 'the coerced value should be a native boolean true').toBe(true);
      }
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('UserHardDeleteEnabled governs whether DELETE /Users removes the user', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'harddel');
      test.skip(!id, 'Could not create the fixture endpoint.');

      const mk = async (tag: string) => {
        const r = await scim(page, id!, 'POST', '/Users', {
          schemas: [CORE_USER], userName: `hd.${tag}.${Date.now()}@example.com`, active: true,
        });
        expect(r.status).toBe(201);
        return r.body.id as string;
      };

      const u1 = await mk('on');
      const delOn = await scim(page, id!, 'DELETE', `/Users/${u1}`);
      expect(delOn.status, 'hard delete ON should succeed').toBeLessThan(400);

      await openSettings(page, id!);
      await toggleFlag(page, 'UserHardDeleteEnabled');

      const u2 = await mk('off');
      const delOff = await scim(page, id!, 'DELETE', `/Users/${u2}`);
      expect(delOff.status, 'hard delete OFF should refuse the DELETE').toBeGreaterThanOrEqual(400);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('GroupHardDeleteEnabled governs whether DELETE /Groups removes the group', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'grpdel');
      test.skip(!id, 'Could not create the fixture endpoint.');

      const mk = async (tag: string) => {
        const r = await scim(page, id!, 'POST', '/Groups', {
          schemas: [CORE_GROUP], displayName: `hd-grp-${tag}-${Date.now()}`,
        });
        expect(r.status).toBe(201);
        return r.body.id as string;
      };

      const g1 = await mk('on');
      expect((await scim(page, id!, 'DELETE', `/Groups/${g1}`)).status).toBeLessThan(400);

      await openSettings(page, id!);
      await toggleFlag(page, 'GroupHardDeleteEnabled');

      const g2 = await mk('off');
      expect(
        (await scim(page, id!, 'DELETE', `/Groups/${g2}`)).status,
        'group hard delete OFF should refuse the DELETE',
      ).toBeGreaterThanOrEqual(400);
    } finally {
      await deleteEndpoint(page, id);
    }
  });

  test('SharedSecretBearerAuthEnabled governs whether the global secret is accepted', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    let id: string | null = null;
    try {
      id = await createEndpoint(page, 'rfc-standard', 'sharedsec');
      test.skip(!id, 'Could not create the fixture endpoint.');

      const probe = () =>
        page.evaluate(
          async ({ token, id }: { token: string; id: string }) => {
            const r = await fetch(`/scim/v2/endpoints/${id}/Users?count=1`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            return r.status;
          },
          { token: TOKEN, id: id! },
        );

      const before = await probe();
      expect(before, 'the global shared secret should work before the flag is touched').toBe(200);

      // Turn the flag OFF through the real Switch.
      //
      // The save confirmation is deliberately NOT asserted here. Measured on
      // dev 2026-07-31: disabling this flag makes the SCIM data plane return
      // 401 (correct), and the web client's shared 401 handler treats ANY 401
      // as an expired ADMIN session - it calls clearStoredToken() and raises
      // the "Authentication Required" dialog, which replaces the MessageBar.
      // The admin API itself keeps returning 200 throughout, so the dialog is
      // a false alarm and a real UI defect. Asserting on the MessageBar would
      // make this test a hostage to that bug; asserting on the persisted value
      // and the server's actual decision measures what this flag really does.
      await openSettings(page, id!);
      await page.getByTestId('settings-flag-SharedSecretBearerAuthEnabled').click();

      await expect
        .poll(async () => asBool((await readSettings(page, id!))['SharedSecretBearerAuthEnabled']), {
          timeout: 20_000,
          message: 'the Switch must actually persist the flag as off',
        })
        .toBe(false);

      const after = await probe();
      expect(after, 'with shared-secret auth off the global secret must be rejected').toBe(401);

      await setSettingViaApi(page, id!, 'SharedSecretBearerAuthEnabled', true);
      await reauth(page);

      const restored = await probe();
      expect(restored, 'turning the flag back on must restore access').toBe(200);
    } finally {
      await deleteEndpoint(page, id);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Presets ARE flag combinations - instantiate every one and measure it
// ---------------------------------------------------------------------------

test.describe('Settings matrix - every preset produces a distinct, working contract', () => {
  const PRESETS = ['entra-id', 'entra-id-minimal', 'rfc-standard', 'minimal', 'user-only', 'user-only-with-custom-ext'];

  for (const preset of PRESETS) {
    test(`preset "${preset}" instantiates and serves a coherent schema contract`, async ({ page }) => {
      test.setTimeout(5 * 60_000);
      let id: string | null = null;
      try {
        id = await createEndpoint(page, preset, `preset-${preset}`);
        test.skip(!id, `Could not create an endpoint with preset ${preset}.`);

        // The Settings tab must render for every preset - a preset that breaks
        // the settings UI would be invisible to an API-only test.
        await openSettings(page, id!);
        const flagCount = await page.locator('[data-testid^="settings-flag-"]').count();
        expect(flagCount, `preset ${preset} should still render its settings surface`).toBeGreaterThan(0);

        // Measure the published contract, not just a 200.
        const schemas = await scim(page, id!, 'GET', '/Schemas');
        expect(schemas.status, `preset ${preset} should publish /Schemas`).toBe(200);
        const resources = (schemas.body.Resources ?? []) as Array<Record<string, unknown>>;
        const user = resources.find((r) => r.id === CORE_USER);
        expect(user, `preset ${preset} must publish the core User schema`).toBeTruthy();

        // Build a create payload from the PUBLISHED required attributes, so the
        // test follows discovery instead of assuming a fixed attribute set -
        // the presets genuinely differ here and a fixed payload would only be
        // testing this file's assumptions.
        const attrs = (user!.attributes ?? []) as Array<Record<string, unknown>>;
        const has = (n: string) => attrs.some((a) => a.name === n);
        const un = `preset.${preset}.${Date.now()}@example.com`;
        const body: Record<string, unknown> = { schemas: [CORE_USER], userName: un, active: true };
        if (has('displayName')) body.displayName = 'Preset Probe';
        if (has('externalId')) body.externalId = `ext-${Date.now()}`;
        if (has('name')) body.name = { givenName: 'Preset', familyName: 'Probe' };
        if (has('emails')) body.emails = [{ value: un, type: 'work', primary: true }];

        const created = await scim(page, id!, 'POST', '/Users', body);
        expect(created.status, `preset ${preset} should accept a schema-conformant User`).toBe(201);
        expect(created.body.id, 'created user must carry an id').toBeTruthy();

        // user-only presets legitimately expose no Group resource.
        const groups = await scim(page, id!, 'GET', '/Groups');
        if (preset.startsWith('user-only')) {
          expect(groups.status, `${preset} should not serve /Groups`).not.toBe(200);
        } else {
          expect(groups.status, `${preset} should serve /Groups`).toBe(200);
        }
      } finally {
        await deleteEndpoint(page, id);
      }
    });
  }
});
