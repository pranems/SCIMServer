# All 37 endpoint settings: behavior and evidence

**Last verified:** 2026-09-28

This reconciles the [frozen independent inventory](evidence/scim-fresh-20260925/settings-inventory.json)
with P7a/P1 and the [P9 corpus](SCIM_ENTRA_COMPATIBILITY.md).
The frozen inventory stays unchanged. It indexes names, not proof of behavior.

The registry has **37 keys: 20 booleans, 14 numbers, 3 other typed values**.
One Boolean (`PersistRequestSecrets`) is retained but inert; credential
visibility is fixed. A registered key is not necessarily an adjustable control.
No default or stored endpoint setting changes in P9.

## How to read the evidence

* **U** means a unit assertion about the outcome, not just registry membership.
* **H** means an existing HTTP outcome assertion or explicitly labeled
  configuration-only check. **L** means a built/live outcome assertion.
* `P9 E...` means executed on **both PostgreSQL and InMemory**, through both
  Supertest and a separately started built local runtime.
* Other named suites are existing evidence whose relevant assertions/source
  were reviewed, **not rerun as part of the 17-case P9 wire corpus**.
  The four JWKS resolver/validator/cache and logging-redaction unit suites
  were additionally run (67 tests); that does not close the live-IdP gaps.
* `gap` means this review does not establish that layer's behavioral proof.
  It does not mean the setting has no implementation.
* `config only` proves acceptance/provenance/reset/bounds, not a timed network,
  physical file, cryptographic or persisted-resource outcome.

Ordinary settings use endpoint override then registry default. Auth-method
declarations in `profile.authentication.methods` take precedence over the
older enablement flags. JWKS settings use endpoint, then server environment,
then bounded hard fallback. Credential caps use endpoint then owner fallback.
Preset-supplied values can differ from registry defaults.

## Reconciled matrix

| Setting | Unset effective value | Actual outcome / limitation | Unit evidence | HTTP evidence | Live evidence |
| --- | --- | --- | --- | --- | --- |
| `PatchOpAllowRemoveAllMembers` | false | Gates bare removal of all Group members; explicit filtered/value-array removal remains available | Group service remove-all assertions | config-flags deny/allow; P9 E10/E11 explicit removals | P9 E10/E11 do not certify bare-remove toggle |
| `VerbosePatchSupported` | false | Enables supported dotted User paths. Off can store literal keys on this base; not an Entra recommendation | User patch engine dotted resolution | P9 E06/E17; I03 pending | E06/E17; off-mode safety gap explicit |
| `logLevel` | inherit | Endpoint logging threshold overrides category/global threshold, not resource behavior | scim-logger level filtering | test-gaps-audit M6 is config acceptance/CRUD smoke only; does not inspect emitted levels | gap: P9 disables log volume |
| `StrictSchemaValidation` | true | Types/cardinality/unknowns/envelope; required and immutable rules also run when off after P7a | schema-validator-p7 | P7a; P9 E01/E08 | P9 E01/E08 and P7a live |
| `RequireIfMatch` | false | Requires conditional write when ETag capability active; does not make check-and-save atomic | enforceIfMatch helper assertions | etag-conditional; query/capability integration boundaries remain | live-test 9y checks 428; not rerun here |
| `AllowAndCoerceBooleanStrings` | true | Schema-aware input coercion; native Booleans need none. Output and legacy active extraction are separate | Boolean-coercion helper/validator | P9 E02-E05/E07; active off-switch gap documented | Same P9 outcomes |
| `SecretTokenBearerAuthEnabled` | false | Per-endpoint bearer create and resource authentication, subject to method declaration precedence | admin-credential controller and method resolver | per-endpoint-credentials accepts correct token/rejects disabled method | existing live credential flow; not every precedence permutation |
| `OAuthClientCredentialsAuthEnabled` | false | Endpoint OAuth credential create/mint; not a general admin-auth switch | admin-credential controller and OAuth service | endpoint-oauth-client and per-endpoint-credentials rejection/mint | existing OAuth live flow; not a P9 cryptographic certification |
| `SharedSecretBearerAuthEnabled` | true | Allows global shared secret for resource requests; method declaration may override | method resolver/shared-secret guard | per-endpoint-credentials denies legacy token when disabled | P9 uses default shared secret in live only; disabled live gap |
| `IncludeWarningAboutIgnoredReadOnlyAttribute` | false | Adds ignored-attribute warnings on writes; does not permit mutation itself | scim-service-helpers warning builder | test-gaps-audit checks warning values | live-test readOnly warning section; not all aliases/Bulk certified |
| `IgnoreReadOnlyAttributesInPatch` | false | Strict PATCH may ignore instead of reject; strict-off strips anyway | User/Group service readOnly checks | test-gaps-audit unchanged readOnly data | live-test strict+ignore case; not rerun in P9 |
| `UserSoftDeleteEnabled` | true | Permits deactivation; also applies to custom resources. Does not remove uniqueness occupancy | User service active-state checks | P9 E02/E13 | E02/E13 |
| `UserHardDeleteEnabled` | true | Permits User/custom DELETE; disabled returns product-policy 400 | User service delete guard | P9 E01/E14; custom elsewhere | E01/E14 |
| `GroupHardDeleteEnabled` | true | Permits Group DELETE; disabled returns 400 | Group service delete guard | P9 E09/E15 | E09/E15 |
| `MultiMemberPatchOpForGroupEnabled` | true | Allows more than one member in an operation; does not govern every SCIM array | Group service cardinality guard | P9 E12 verifies no partial write | E12; multi-member-enabled boundary elsewhere |
| `SchemaDiscoveryEnabled` | true | Controls endpoint discovery reads, not resource write validity | discovery service/controller | test-gaps-audit-5 blocks all three discovery routes and verifies User readback still works | existing discovery live checks; toggle not P9 |
| `logFileEnabled` | true | Controls per-endpoint file sink; global main log is a different sink | file-log transport routing | config-flags/log defaults are config only for physical file output | live-test 9z-K is default/config only; physical file gap |
| `PrimaryEnforcement` | passthrough | Final-payload reject/normalize/pass-through; normalize keeps first true. Not ordered PATCH primary handoff | schema validator primary assertions | existing primary tests; P9 I02 pending | I02 pending; do not claim RFC handoff from final-state policy |
| `WifCredentialsEnabled` | false | Enables WIF trust/credential and mint path, with method precedence | admin-credential controller accepts/rejects WIF and method override | wif-assertion and wif-tenant-gleaning | existing WIF live proof; not P9 |
| `CredentialSecretVisibility` | always | Fixed retained encrypted reveal; new once rejected; legacy value resolves always | endpoint-config and admin-credential controller | credential-secret-visibility rejects once; credential-reveal checks reveal contract | existing reveal live flow; once is not a supported policy |
| `EnforceResourceTypes` | true | Unserved User/Group lists reject; false gives empty warning response for probes; item/write still reject | resource-type-enforcement helper | profile-enforcement-gaps assertions | existing profile live checks; full custom/Bulk integration separate |
| `JwksFetchTimeoutMs` | 5000 ms | AbortSignal bounds individual fetch attempt | external-jwks-validator signal assertion | endpoint-egress-policy config/provenance only | gap: no live slow-IdP timeout proof here |
| `JwksFetchRetries` | 2 | Retries transient failures; endpoint 0 means one attempt | external-jwks-validator counts actual mock fetches | endpoint-egress-policy config only | gap: no live transient-IdP injection |
| `JwksFetchRetryBackoffMs` | 200 ms | Exponential retry delay bounded by total deadline | external-jwks-validator retry/deadline behavior | config-flags bounds only | gap: no live timer measurement |
| `JwksCacheMaxAgeMs` | 86400000 ms | Key-set freshness, not schema/profile cache TTL | external-jwks-cache.w14 expiry | config-flags bounds only | gap: no live day-long expiry |
| `JwksTotalDeadlineMs` | 10000 ms | Bounds whole fetch/retry ladder | external-jwks-validator elapsed time and early stop | gap: no HTTP timed-failure assertion identified | gap |
| `JwksMaxResponseBytes` | 1048576 | Rejects oversized key response | external-jwks-validator size rejection/boundary | gap: not inferred from registry bounds | gap |
| `JwksMaxKeys` | 100 | Rejects too many keys; exact boundary accepted | external-jwks-validator key-count assertions | gap | gap |
| `MaxActiveBearerCredentials` | 5 | Active bearer capacity at creation/reactivation | admin-credential controller cap and raised-cap negative control | credential-caps rejects excess and frees slot on deactivation | gap: P9 does not exhaust credentials |
| `MaxActiveOAuthClientCredentials` | 5 | Independent active OAuth credential capacity | admin-credential controller OAuth-specific cap | credential-caps P2-E3 proves independent bearer/OAuth budgets | gap |
| `MaxActiveWifTrusts` | 10 | Independent active WIF capacity | Gap: no dedicated WIF-cap outcome assertion identified; generic cap code is not that proof | registry/UI presence is not cap enforcement proof; gap here | gap |
| `JwksMaxCacheEntries` | 50 | Bounds cache cardinality by eviction | external-jwks-validator evicts oldest; cache tests | gap: no HTTP churn assertion identified | gap |
| `JwksRefreshIntervalMs` | 3600000 ms | Background refresh threshold, below freshness TTL for warm cache | external-jwks-cache.w14 fake-time refresh | config-flags bounds only | gap |
| `JwksUnknownKidMinIntervalMs` | 300000 ms | Limits synchronous unknown-key refresh frequency | external-jwks-cache.w14 repeated unknown-kid fetch counts | config-flags bounds only | gap |
| `JwksStaleIfErrorMs` | 172800000 ms | Hard maximum age for stale-key fallback; 0 disables | external-jwks-cache.w14 stale success/expiry rejection | config-flags bounds only | gap |
| `PersistRequestSecrets` | false, fixed | No-op compatibility input; cannot bypass mandatory redaction | logging-redaction verifies persisted body/header values for true/false | RequestLog flows elsewhere; not a toggle that can succeed | gap: P9 does not inspect persisted logs |
| `RfcCompliantSubAttributes` | false | True rejects populated complex sub-attributes independently of strict; false is a non-RFC extension | schema validator nested-shape assertions | rfc-compliant-subattributes all flag combinations | existing subattribute live tests, not P9 |

## Direct evidence entry points

These are pointers to executable outcomes, not a claimed rerun of every suite:

* [Registry helpers](../api/src/modules/endpoint/endpoint-config.interface.spec.ts):
  338 existing assertions plus P9's six guidance/inventory tests across two files.
  Registry membership/UI-key tests prove inventory, not behavior.
* [JWKS validator](../api/src/oauth/external-jwks-validator.service.spec.ts),
  [cache lifecycle](../api/src/oauth/external-jwks-cache.w14.spec.ts) and
  [egress resolver](../api/src/oauth/egress-policy.spec.ts): fetch counts,
  elapsed deadlines, bytes/keys, cache eviction/fake-time expiry and precedence.
* [Logging redaction](../api/src/modules/logging/logging-redaction.spec.ts):
  inspects durable row strings and retained non-secret diagnostics.
* [Credential HTTP](../api/test/e2e/per-endpoint-credentials.e2e-spec.ts),
  [credential caps](../api/test/e2e/credential-caps.e2e-spec.ts),
  [credential controller units](../api/src/modules/scim/controllers/admin-credential.controller.spec.ts),
  [OAuth HTTP](../api/test/e2e/endpoint-oauth-client.e2e-spec.ts),
  [WIF HTTP](../api/test/e2e/wif-assertion.e2e-spec.ts),
  [keyed lookup](../api/test/e2e/credential-keyed-lookup.e2e-spec.ts).
* [Config HTTP](../api/test/e2e/config-flags.e2e-spec.ts),
  [effective egress HTTP](../api/test/e2e/endpoint-egress-policy.e2e-spec.ts),
  [readOnly HTTP](../api/test/e2e/test-gaps-audit.e2e-spec.ts),
  [profile enforcement](../api/test/e2e/profile-enforcement-gaps.e2e-spec.ts),
  [subattributes](../api/test/e2e/rfc-compliant-subattributes.e2e-spec.ts).
* [Existing live suite](../scripts/live-test.ps1): referenced sections above
  are not included in the P9 executed counts.

### Capability fields are separate

`patch.supported`, `bulk.supported` and limits, `filter.supported` and limit,
`sort.supported`, `etag.supported`, `changePassword.supported` are profile
capabilities, not extra keys in the 37-setting registry. Enabling unsupported
password change is rejected. Entra Group provisioning requires PATCH.
No optional protocol defaults were enabled by P9. Discovery truthfulness,
alias/Bulk parity, `.search`, ordered PATCH and atomic persistence are the
parent's integration claims, not inferred from this inventory.

**Disposition:** retained/inert controls are now clearly labeled; behavioral
gaps remain explicit. P9 closes wire evidence for its listed cases, not every
setting/resource/backend/operation permutation. Parent consolidation owns
cross-package checks. No UI code or dependency was changed.
