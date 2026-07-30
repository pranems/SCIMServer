/**
 * rfc-compliant-subattributes-flag.spec.ts - browser coverage for the
 * RfcCompliantSubAttributes endpoint configuration flag.
 *
 * WHAT THE FLAG DOES
 *   OFF (default) - current behavior is preserved exactly: a schema may
 *   declare a complex sub-attribute and a payload populating it is
 *   accepted, while a multi-valued SIMPLE sub-attribute is rejected.
 *   ON - RFC 7643 is followed instead:
 *     R1  a complex sub-attribute is refused (2.3.8, erratum 8415)
 *     R2  a multi-valued simple sub-attribute is accepted and each
 *         element is type-checked (1.2, erratum 5607)
 *   It is STANDALONE: it applies whether StrictSchemaValidation is on or
 *   off, and turning it on does not enable strict validation.
 *
 * WHY THIS SPEC EXISTS (rule R10 - presence is not correctness)
 *   Asserting only that the Switch is rendered would pass even if the
 *   toggle were wired to nothing. So every test here drives the REAL
 *   Switch in the REAL browser and then measures a real OUTCOME:
 *     - the persisted flag value read back from the admin API, and
 *     - the SCIM server's actual accept/reject decision for a payload
 *       that only this flag governs.
 *   The layout test measures bounds via getBoundingClientRect (rule R1),
 *   not CSS properties.
 *
 * Runs against local dev (:4000), Docker compose (:8080) and Azure dev.
 * Creates its own throwaway endpoint and deletes it in a finally block,
 * so it is safe on shared prod-shaped tenants.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

const FLAG = 'RfcCompliantSubAttributes';
const SWITCH = `settings-flag-${FLAG}`;
const CORE_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

/**
 * Creates an endpoint whose User schema declares BOTH shapes the flag
 * governs, so the server's decision is attributable to this flag alone:
 *   address.geo  - a COMPLEX sub-attribute (illegal under RFC 2.3.8)
 *   licenses.skus - a multi-valued SIMPLE sub-attribute (legal under 1.2)
 */
async function createEndpoint(page: Page): Promise<string | null> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

  return page.evaluate(async (token: string) => {
    const create = await fetch('/scim/admin/endpoints', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `e2e-rfcsub-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        profilePreset: 'rfc-standard',
      }),
    });
    if (!create.ok) return null;
    const endpoint = await create.json();
    const id: string = endpoint.id;

    // Read-modify-write the schema array. Replacing it wholesale would
    // orphan every ResourceType -> schema reference and the server would
    // (correctly) reject the update for an unrelated reason.
    const cur = await fetch(`/scim/admin/endpoints/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!cur.ok) return null;
    const overview = await cur.json();
    const schemas = JSON.parse(JSON.stringify(overview.profile?.schemas ?? []));
    const userSchema = schemas.find(
      (s: { id?: string }) => s.id === 'urn:ietf:params:scim:schemas:core:2.0:User',
    );
    if (!userSchema) return null;

    userSchema.attributes.push({
      name: 'address',
      type: 'complex',
      multiValued: false,
      required: false,
      subAttributes: [
        { name: 'street', type: 'string', multiValued: false, required: false },
        {
          name: 'geo',
          type: 'complex',
          multiValued: false,
          required: false,
          subAttributes: [
            { name: 'lat', type: 'decimal', multiValued: false, required: false },
            { name: 'lon', type: 'decimal', multiValued: false, required: false },
          ],
        },
      ],
    });
    userSchema.attributes.push({
      name: 'licenses',
      type: 'complex',
      multiValued: true,
      required: false,
      subAttributes: [
        { name: 'name', type: 'string', multiValued: false, required: false },
        { name: 'skus', type: 'string', multiValued: true, required: false },
      ],
    });

    const patch = await fetch(`/scim/admin/endpoints/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: { schemas } }),
    });
    if (!patch.ok) return null;
    return id;
  }, TOKEN);
}

async function deleteEndpoint(page: Page, id: string): Promise<void> {
  await page.evaluate(
    async ({ token, endpointId }: { token: string; endpointId: string }) => {
      await fetch(`/scim/admin/endpoints/${endpointId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    },
    { token: TOKEN, endpointId: id },
  );
}

/** Reads the flag value the SERVER actually persisted. */
async function readFlagFromApi(page: Page, id: string): Promise<unknown> {
  return page.evaluate(
    async ({ token, endpointId }: { token: string; endpointId: string }) => {
      const r = await fetch(`/scim/admin/endpoints/${endpointId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return undefined;
      const data = await r.json();
      return data.profile?.settings?.RfcCompliantSubAttributes;
    },
    { token: TOKEN, endpointId: id },
  );
}

/** POSTs a SCIM user and returns the real HTTP status the server chose. */
async function postUser(
  page: Page,
  id: string,
  user: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  return page.evaluate(
    async ({
      token,
      endpointId,
      payload,
    }: {
      token: string;
      endpointId: string;
      payload: Record<string, unknown>;
    }) => {
      const r = await fetch(`/scim/endpoints/${endpointId}/Users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/scim+json',
        },
        body: JSON.stringify(payload),
      });
      let body: unknown = null;
      try {
        body = await r.json();
      } catch {
        body = null;
      }
      return { status: r.status, body };
    },
    { token: TOKEN, endpointId: id, payload: user },
  );
}

function nestedUser(suffix: string) {
  return {
    schemas: [CORE_USER],
    userName: `rfcsub-${suffix}-${Date.now()}@example.com`,
    displayName: `rfcsub ${suffix}`,
    emails: [{ value: `rfcsub-${suffix}-${Date.now()}@example.com`, type: 'work' }],
    address: { street: '1 Main St', geo: { lat: 47.6, lon: -122.3 } },
  };
}

function multiValuedSubUser(suffix: string) {
  return {
    schemas: [CORE_USER],
    userName: `rfcsub-${suffix}-${Date.now()}@example.com`,
    displayName: `rfcsub ${suffix}`,
    emails: [{ value: `rfcsub-${suffix}-${Date.now()}@example.com`, type: 'work' }],
    licenses: [{ name: 'E5', skus: ['SKU-A', 'SKU-B'] }],
  };
}

/** Drives the real Switch and waits for the save to be acknowledged. */
async function toggleFlag(page: Page, id: string, on: boolean): Promise<void> {
  await page.goto(`/endpoints/${id}/settings`);
  await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });

  const toggle = page.getByTestId(SWITCH);
  await expect(toggle).toBeVisible();
  if ((await toggle.isChecked()) === on) return;

  await toggle.click();
  await expect(page.getByTestId('settings-feedback-success')).toBeVisible({ timeout: 20_000 });
  await expect(toggle).toBeChecked({ checked: on });
}

test.describe('RfcCompliantSubAttributes flag - UI toggle drives real server behavior', () => {
  test('defaults OFF, and OFF preserves current behavior end-to-end', async ({ page }) => {
    const id = await createEndpoint(page);
    test.skip(!id, 'Could not create the fixture endpoint (admin denied or preset unavailable).');

    try {
      await page.goto(`/endpoints/${id}/settings`);
      await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });

      // OUTCOME 1: the Switch renders OFF for a brand-new endpoint.
      await expect(page.getByTestId(SWITCH)).not.toBeChecked();

      // OUTCOME 2: the server agrees - the flag is absent or false.
      const persisted = await readFlagFromApi(page, id!);
      expect(persisted === undefined || persisted === false || persisted === 'False').toBe(true);

      // OUTCOME 3: with the flag OFF the nested complex sub-attribute is
      // ACCEPTED. This is the legacy behavior the default must preserve.
      const nested = await postUser(page, id!, nestedUser('off-nested'));
      expect(nested.status).toBe(201);

      // OUTCOME 4: and the multi-valued simple sub-attribute is REJECTED,
      // which is the pre-existing gap the flag exists to close.
      const multi = await postUser(page, id!, multiValuedSubUser('off-multi'));
      expect(multi.status).toBe(400);
    } finally {
      await deleteEndpoint(page, id!);
    }
  });

  test('turning the Switch ON changes what the SCIM server accepts', async ({ page }) => {
    const id = await createEndpoint(page);
    test.skip(!id, 'Could not create the fixture endpoint.');

    try {
      await toggleFlag(page, id!, true);

      // OUTCOME 1: the UI toggle actually persisted to the server.
      const persisted = await readFlagFromApi(page, id!);
      expect(persisted === true || persisted === 'True').toBe(true);

      // OUTCOME 2 (R1 of the flag): the nested complex sub-attribute that
      // was accepted a moment ago is now REJECTED, and the error names the
      // offending path - so the rejection is attributable to this rule and
      // not to unrelated validation noise.
      const nested = await postUser(page, id!, nestedUser('on-nested'));
      expect(nested.status).toBe(400);
      const body = nested.body as {
        detail?: string;
        ['urn:scimserver:api:messages:2.0:Diagnostics']?: {
          attributePaths?: string[];
          triggeredBy?: string;
        };
      };
      const diag = body['urn:scimserver:api:messages:2.0:Diagnostics'];
      expect(diag?.attributePaths ?? []).toContain('address.geo');
      expect(diag?.triggeredBy).toBe(FLAG);

      // OUTCOME 3 (R2 of the flag): the multi-valued SIMPLE sub-attribute
      // that was rejected a moment ago is now ACCEPTED and round-trips.
      const multi = await postUser(page, id!, multiValuedSubUser('on-multi'));
      expect(multi.status).toBe(201);
      const created = multi.body as { licenses?: { skus?: string[] }[] };
      expect(created.licenses?.[0]?.skus).toEqual(['SKU-A', 'SKU-B']);
    } finally {
      await deleteEndpoint(page, id!);
    }
  });

  test('toggling back OFF restores the original behavior (no one-way door)', async ({ page }) => {
    const id = await createEndpoint(page);
    test.skip(!id, 'Could not create the fixture endpoint.');

    try {
      await toggleFlag(page, id!, true);
      expect((await postUser(page, id!, nestedUser('roundtrip-on'))).status).toBe(400);

      await toggleFlag(page, id!, false);

      // OUTCOME: the server is back to the legacy decision for BOTH rules.
      expect((await postUser(page, id!, nestedUser('roundtrip-off'))).status).toBe(201);
      expect((await postUser(page, id!, multiValuedSubUser('roundtrip-off'))).status).toBe(400);

      const persisted = await readFlagFromApi(page, id!);
      expect(persisted === false || persisted === 'False').toBe(true);
    } finally {
      await deleteEndpoint(page, id!);
    }
  });

  test('the flag is standalone - it applies with StrictSchemaValidation OFF', async ({ page }) => {
    const id = await createEndpoint(page);
    test.skip(!id, 'Could not create the fixture endpoint.');

    try {
      await page.goto(`/endpoints/${id}/settings`);
      await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });

      // Turn StrictSchemaValidation OFF through its own Switch.
      const strict = page.getByTestId('settings-flag-StrictSchemaValidation');
      if (await strict.isChecked()) {
        await strict.click();
        await expect(page.getByTestId('settings-feedback-success')).toBeVisible({ timeout: 20_000 });
        await expect(strict).not.toBeChecked();
      }

      await toggleFlag(page, id!, true);

      // OUTCOME 1: the nesting rule still fires with strict OFF. If the
      // flag were secretly gated on StrictSchemaValidation this would 201.
      const nested = await postUser(page, id!, nestedUser('standalone'));
      expect(nested.status).toBe(400);

      // OUTCOME 2: strict was NOT smuggled back on - an undeclared
      // attribute is still tolerated, proving the flag did not widen
      // validation beyond its own two rules.
      const undeclared = {
        ...nestedUser('standalone-undeclared'),
        address: { street: '1 Main St' },
        somethingUndeclared: 'tolerated',
      };
      expect((await postUser(page, id!, undeclared)).status).toBe(201);
    } finally {
      await deleteEndpoint(page, id!);
    }
  });

  test('the flag row is laid out within its card at wide and narrow viewports', async ({ page }) => {
    const id = await createEndpoint(page);
    test.skip(!id, 'Could not create the fixture endpoint.');

    try {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 900, height: 900 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`/endpoints/${id}/settings`);
        await expect(page.getByTestId('settings-tab')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId(SWITCH)).toBeVisible();

        // Rule R1: measure real bounds. A long description must not push
        // the row past its card, and the Switch must stay on screen.
        const bounds = await page.evaluate((flag: string) => {
          const row = document.querySelector(`[data-testid="settings-flag-row-${flag}"]`);
          const toggle = document.querySelector(`[data-testid="settings-flag-${flag}"]`);
          if (!row || !toggle) return null;
          const card = row.parentElement;
          if (!card) return null;
          const r = row.getBoundingClientRect();
          const c = card.getBoundingClientRect();
          const t = toggle.getBoundingClientRect();
          return {
            rowRight: r.right,
            rowWidth: r.width,
            cardRight: c.right,
            toggleRight: t.right,
            toggleWidth: t.width,
            viewportWidth: window.innerWidth,
          };
        }, FLAG);

        expect(bounds).not.toBeNull();
        // The row is bounded by its card (1px tolerance for sub-pixel layout).
        expect(bounds!.rowRight).toBeLessThanOrEqual(bounds!.cardRight + 1);
        // The row actually occupies width - a collapsed row would mean the
        // description never rendered.
        expect(bounds!.rowWidth).toBeGreaterThan(100);
        // The Switch is fully on screen and is a real, sized control.
        expect(bounds!.toggleRight).toBeLessThanOrEqual(bounds!.viewportWidth + 1);
        expect(bounds!.toggleWidth).toBeGreaterThan(10);
      }
    } finally {
      await deleteEndpoint(page, id!);
    }
  });
});
