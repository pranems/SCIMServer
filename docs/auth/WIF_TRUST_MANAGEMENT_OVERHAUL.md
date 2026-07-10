# WIF Trust Management Overhaul (2026-07)

**Status:** IMPLEMENTED (0.54.0-alpha.33)
**Scope:** Federated Identity (WIF) credential UX + trust lifecycle + config-time reachability verification, plus a cross-cutting table scroll/resize fix.

This document covers the 2026-07 batch of operator-requested WIF improvements and the closure work that followed a deep self-audit. It complements the original WIF epic docs ([CONNECTION_INFO_AND_ENTRA_SETUP.md](CONNECTION_INFO_AND_ENTRA_SETUP.md), [EXECUTION_ISSUES_AND_RCA.md](EXECUTION_ISSUES_AND_RCA.md)).

## Motivation

Operators reported that the WIF trust UI was hard to use and that a trust could be saved with URLs that were never actually checked, producing runtime surprises later. The batch delivers:

1. Every display box / table is scrollable AND auto-expands with the window.
2. WIF input fields stack vertically at full width (were a scattered narrow grid).
3. A saved trust shows all of its important field values.
4. A saved trust is fully editable in place.
5. Entered URLs are format-validated, reachability-checked, and confirmed to serve what they should - at input time, at BOTH the UI and the API.
6. The JWKS host allowlist is shown in the form, and a not-allowed host warns with a one-click inline add.
7. Roles are advisory by default (a missing role no longer blocks the flow); strict enforcement is opt-in.

## Backend

### `PUT /scim/admin/endpoints/{id}/credentials/{cid}` - edit a WIF trust

Edits a `wif` credential in place. Applies the same alias normalization + required-field validation + public-key projection as create, then replaces the metadata. Only `wif` credentials are editable (bearer/oauth_client secrets are rotated, not edited). Can also change the label. Never returns a secret.

- 400 when the target is not a `wif` credential or a required field is dropped.
- 404 when the credential does not exist or belongs to another endpoint.

Repository: a new optional `updateMetadata(id, metadata)` + `updateLabel(id, label)` on `IEndpointCredentialRepository` (InMemory + Prisma).

### `POST /scim/admin/endpoints/{id}/wif/verify` - reachability + liveness

Runs a NON-throwing, SSRF-gated checklist against the trust's issuer + JWKS URI and returns per-check results. Same host allowlist as the runtime JWKS fetch (a disallowed host is a failed check, never fetched).

```json
{
  "ok": false,
  "checks": [
    { "id": "issuerFormat", "label": "Issuer is a valid https URL", "ok": true, "detail": "https://login.microsoftonline.com/<tenant>/v2.0" },
    { "id": "issuerHostAllowed", "label": "Issuer host on the allowlist", "ok": true, "detail": "login.microsoftonline.com" },
    { "id": "issuerReachable", "label": "Issuer serves OIDC discovery", "ok": true, "detail": "Discovery document issuer matches." },
    { "id": "jwksFormat", "label": "JWKS URI is a valid https URL", "ok": true, "detail": "https://login.windows.net/<tenant>/discovery/v2.0/keys" },
    { "id": "jwksHostAllowed", "label": "JWKS host on the allowlist", "ok": true, "detail": "login.windows.net" },
    { "id": "jwksReachable", "label": "JWKS URI reachable", "ok": false, "detail": "GET returned HTTP 404." },
    { "id": "jwksServesKeys", "label": "JWKS serves a non-empty key set", "ok": false, "detail": "not a JWKS" }
  ]
}
```

### Verify-on-save gate (`verify: true`)

`POST .../credentials` and `PUT .../credentials/{cid}` accept an optional `verify: true`. When set, the same verification runs BEFORE persisting; a failure rejects with `422 Unprocessable Entity` carrying `scimType: invalidValue` + the `checks[]` array, and nothing is persisted. Absent/false preserves the ability to pre-stage a trust before its IdP is live.

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
  "scimType": "invalidValue",
  "detail": "WIF trust verification failed: JWKS URI reachable: GET returned HTTP 404.",
  "checks": [
    { "id": "jwksReachable", "label": "JWKS URI reachable", "ok": false, "detail": "GET returned HTTP 404." }
  ]
}
```

### Roles advisory by default

`WifAssertionValidatorService` logs and continues when a required role is missing, unless the trust sets `roleEnforcement: "enforce"` (values: `off` default, `shadow`, `enforce`). A provisioning flow reaches the next step even if the IdP has not yet assigned the app role.

### Trust display projection

The endpoint overview BFF (`GET .../overview`) projects a `wif` credential's public fields onto `credentials[].wif` via a closed allowlist (`expectedIssuer`, `expectedSubject`, `expectedAudience`, `jwksUri`, `allowedTenantId`, `requiredRoles`, `scope`, `assertionProfile`, `issuedTokenTtlSec`, `roleEnforcement`). No secret exists on a WIF credential; the closed allowlist guarantees no internal seam field leaks.

## Frontend

- **Vertical form** - the WIF fields stack one per row at full width (`flexDirection: column`), expanding on resize.
- **Trust display grid** - each configured trust renders every field value as a copyable field.
- **Edit mode** - an Edit button per trust loads it into the form; Save-changes (PUT) / Cancel-edit.
- **Verify** - a "Verify issuer + JWKS reachability" button renders the checklist. Save runs `verify: true` first; on 422 it shows the checklist + a "Save anyway" that re-submits with `verify: false`.
- **JWKS allowlist notice** - lists the effective hosts; a not-allowed JWKS host warns with a one-click "Add to allowlist".
- **Inline URL validation** - issuer + JWKS fields show an inline message on a non-https / malformed URL.
- **Role-enforcement dropdown** - Advisory (default) / Shadow / Enforce.

## Tables (scroll + resize)

`LogsPage`, `LogsTab`, `WorkbenchPage` history, `DiscoveryExplorerPage` diff, and `OperationsPage` tables use `table-layout: fixed` + percentage/colgroup widths (columns expand proportionally) inside `overflow-x: auto` wrappers with a sane `min-width` (a narrow window scrolls instead of clipping). Enforced by the R5 rules + `scripts/audit-table-layout.ps1`.

## Test coverage

| Layer | Coverage |
|---|---|
| API unit | `admin-credential.controller.spec` (PUT edit, label edit, verify-on-save 422 gate), `wif-discovery-resolver.service.spec` (verifyTrust checklist), `dashboard.controller.spec` (wif projection + roleEnforcement), `wif-assertion-validator.service.spec` (roles advisory) |
| API E2E | `wif-assertion.e2e-spec` (advisory default + enforce opt-in) |
| Web vitest | `CredentialsTab.test` (trust display values, edit flow, JWKS notice, verify checklist, verify-on-save + Save-anyway, inline URL validation, role-enforcement) |
| Playwright | `wif-trust-management.spec` (trust grid values, edit mode, JWKS notice, verify checklist, verify-on-save override, inline validation, role-enforcement) |
| Live | `live-test.ps1` section 9z-AV (PUT edit + label, verify pass/fail, verify-on-save 422) |
