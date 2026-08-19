# Auth + WIF + SyncFabric remaining-work register (X16)

**Status:** STOCK-TAKE. Every row below was verified against real sources on **2026-08-19**, not
carried forward from a previous document.

**Last verified:** 2026-08-19

| Source | Snapshot verified | How |
|---|---|---|
| SCIMServer | `origin/master` `09b4b78d`, api + web `package.json` both **0.55.6** | `git rev-parse`, `package.json` read |
| SyncFabric | `origin/master` `38c429b511`, 2026-08-19, **0 commits ahead** of the guide's snapshot | `git fetch --prune` in `C:\one\AD-IAM-Services-SyncFabric` (read-only) |
| Canonical WIF guide | revision 7, **6,503 lines** (OneDrive) | line count |
| In-repo guide mirror | **5,642 lines** | line count |

This register exists because the answer to "what is left?" was spread across the delivery plan,
the canonical guide's action list, GitHub issues, and the deployment estate, and **each of those
four sources disagreed with the others**. Section 1 records what the cross-check corrected.

---

## 1. Corrections this stock-take made to its own sources

These are findings, not restatements. Each one means a document was saying something untrue.

| # | Source that was wrong | What it claimed | What is actually true | Evidence |
|---|---|---|---|---|
| **C1** | Delivery plan Section 1, JWKS row | "JWKS pre-warm / background refresh: **still none** (lazy fetch, 10-min TTL)" | W1.4 shipped in v0.55.5: a background refresh sweep exists (`refreshTimer`, `setInterval`, `unref`ed) and the TTL is 24 h | [external-jwks-validator.service.ts](../../api/src/oauth/external-jwks-validator.service.ts) L126-L174 |
| **C2** | Delivery plan Section 1, mint row | "Mint `client_secret` path: **inlined** in the controller" | W2.3 shipped: the provider is its own class with its own spec | [client-secret-token-provider.ts](../../api/src/modules/scim/controllers/client-secret-token-provider.ts) |
| **C3** | Canonical guide, gap-matrix header | `09b4b78d` is "**v0.55.7**" | **There is no v0.55.7.** No commit ever set `api/package.json` to `0.55.7`; there is no such CHANGELOG heading. The version is **0.55.6** | `git log -S'"version": "0.55.7"' -- api/package.json` returns nothing |
| **C4** | Canonical guide, actions A8 / A9 / A12 | paths under `api/src/modules/endpoint/` | Those paths do not exist. Real paths are `api/src/modules/endpoint/**services**/endpoint.service.ts` and `api/src/modules/**scim/controllers**/admin-authentication-method.controller.ts` | `Get-ChildItem -Recurse` |
| **C5** | Canonical guide, connector-impact finding | "two of three prod auth-code-grant connectors have no configured URI" | **Correct, and understated.** Three more connectors declare the setting **empty**, which the same fail-closed predicate also denies. See Section 4 | `DeploymentSettings.xml` scan |
| **C6** | SyncFabric design doc `docs/oauth2-token-exchange-uri-validation/API.md` | "AmazonBusiness is the **only** PROD member" of configurable code-grant connectors | Three prod connector configs declare `OAuth2AuthorizationCodeGrant`, not one. The safety argument for a global `Enabled=True` rests on a premise the repo contradicts | `connector_configurations/prod` scan |

**C3 and C4 matter beyond their own rows.** The guide is the document that drives this backlog, and
a stale path in an action item means whoever picks that action up starts by failing to find the file.
The guide was never wrong about *what* to do, only about *where*, but a wrong location is what turns
a 20-minute fix into an investigation.

### 1.1 The recurring failure: the plan understates its own progress

C1 and C2 are the **second** occurrence of a documented failure mode. The plan's own v0.55.2
change-log entry says:

> "Section 1's state table had gone stale in the understating direction: Waves 1 and 2 shipped
> without it being updated, so the plan described work as outstanding that was already delivered."

It has now happened again, to different rows, for the same reason: an item's **status line** is
updated when the item ships, but the **summary table at the top** is not, because nothing binds them.
Two sightings of one pattern is this repo's own promotion threshold.

**Disposition: scheduled** as item **N4** in Section 5. The structural fix is to stop maintaining
the same fact twice: Section 1 should state the *question* each row answers and defer the answer to
the item's status line, or a gate should assert that no Section 1 row says "none"/"inlined"/"still"
while the owning item says DELIVERED. A third manual correction is not a fix.

---

## 2. Delivery-plan work items still open

From [AUTH_CONSOLIDATED_DELIVERY_PLAN.md](AUTH_CONSOLIDATED_DELIVERY_PLAN.md). **11 open**, 2 settled
(not open), 2 partially delivered.

| ID | Item | Wave | Est | Blocked by | Notes |
|---|---|---|---|---|---|
| **W1.2** | Startup JWKS pre-warm | 1 | S | nothing (W1.4 landed) | **Last Wave 1 item.** DB-pool half already done. Now unblocked |
| **W3.5** | Credential/trust cache + typed lookup + composite index | 3 | M | W3.1 | Needs a Prisma migration + in-memory parity |
| **W4.1** | RFC 8693 provider strategy | 4 | L | W2, W3 | Wave 4 spine |
| **W4.2** | Advertise 8693 only when active | 4 | S | W4.1 | Closes the W0.3 truth |
| **W4.3** | Real-SyncFabric 8693 validation | 4 | M | W4.1 | Empirical gate |
| **W5.1** | Finite auth-persona catalog | 5 | L | W2-W4 | YAGNI risk: presets only, no DSL |
| **W5.2** | Claim strengthening + lifetime cap | 5 | M | W3 + capture | Shadow before enforce |
| **W5.3** | `typ=at+jwt` | 5 | M | W2 | `jti` already shipped in W3.8; only the type header is left |
| **W5.4** | Opaque tokens + introspection + revocation | 5 | XL | W5.3 | Optional track, split before starting |
| **W6.1** | Remove legacy fallbacks | 6 | M | W3-W5 + telemetry | Gated on zero-use telemetry |
| **W6.2** | `private_key_jwt` / mTLS / DPoP | 6 | XL | W2 | Future track, on demand |

**Settled, not open (do not re-raise):**

- **W0.1** token-route secret redaction: **DECLINED** twice by the operator. `PERSIST_REQUEST_SECRETS`
  defaults `true` **by design**; `logging-redaction.spec.ts:80-87` asserting that default is correct.
  Still in scope separately: retention and log-read access (see A3' / item S1).
- **W3.3** endpoint-UUID audience default: **DEFERRED** pending operator confirmation. There is no
  correctness hole to close unilaterally, since `buildTrust` already requires a non-empty
  `expectedAudience` at mint time.

**Partial:** W3.1 (per-variation profile routing shipped; the versioned aggregate and 7-state
migration are deferred and may never be needed) and W2.5 (value-preserving core shipped; the
legacy-umbrella retirement and enforcement flip are still scheduled).

---

## 3. Canonical guide action list (A1-A15)

Re-checked against source. Path corrections from C4 applied.

| ID | Action | Sev | Verified state on 2026-08-19 |
|---|---|---|---|
| **A1/A13** | Re-sync the in-repo guide mirror with the canonical copy | Blocking | **OPEN and widening.** Canonical 6,503 lines vs mirror 5,642, a **861-line** gap. Neither is a superset: the mirror holds the authoritative section 0.1 decision record, the canonical holds revisions 6-7. A blind copy in either direction **destroys information** - this needs a merge, not an overwrite |
| **A8** | Structured `auth_methods_changed` audit event | High | **CONFIRMED OPEN, and cheap.** `admin-authentication-method.controller.ts` has **2 mutating handlers** (`add` L81 `@Post()`, `remove` L124 `@Delete(':methodId')`) and **0** `emitAuthAdminEvent` calls, while `admin-credential.controller.ts`, `admin-jwks-host.controller.ts` and `endpoint.service.ts` all emit. The helper already exists in [auth-admin-event.ts](../../api/src/oauth/auth-admin-event.ts). This is the **highest value-per-effort item in the register** |
| **A9** | Optimistic concurrency on profile writes | High | OPEN. No `ifMatch` / `rowVersion` guard in [endpoint.service.ts](../../api/src/modules/endpoint/services/endpoint.service.ts) |
| **A10** | Reject a partial `authentication` block | High | OPEN |
| **A4** | Require `client_id` for RFC 7523 | High | Largely closed by **W3.7** (v0.54.78), which rejects a mismatch with `wif_client_id_mismatch`. Residual: `client_id` is still not *required* when the trust pins no `targetClientId`. Re-scope rather than re-implement |
| **A3'** | Bound RequestLog retention + restrict read access | High | OPEN. This is the part of the W0.1 area that was **never** declined. The declined half was redaction; retention and access control remain in scope |
| **A2** | Transport persona axis | Med | OPEN, folds into W5.1 |
| **A5** | Key-replay denylist on `uti` not `jti` | Med | OPEN |
| **A6** | Surface `azpacr` in the decision trace | Med | OPEN |
| **A7** | Reject `api://<appId>` in `expectedAudience` | Med | OPEN |
| **A11** | Document the 6 merge rules | Low | OPEN |
| **A12** | Fix the `// Deep-merge settings (additive)` comment | Low | OPEN. Confirmed at [endpoint.service.ts](../../api/src/modules/endpoint/services/endpoint.service.ts) **L799** - line number right, directory wrong in the guide |
| **A14** | Document that the token-endpoint host is config-gated | Low | OPEN |
| **A15** | Model fail-closed denial in test-ISV scenarios | Med | OPEN, and now better motivated by Section 4 |

### 3.1 Empirical gates still unmet

1. First-party sovereign application ID.
2. Real SyncFabric to SCIMServer end-to-end capture, both modes.
3. **WIF token-mint latency measurement.** The guide has deferred this four times, but SCIMServer
   commit `6504626e` "docs: WIF token-mint latency analysis (X11)" already exists and was never
   consulted. **This gate may already be satisfied** - check before scheduling a fifth deferral.
4. Fail-closed denial telemetry from SyncFabric.

---

## 4. SyncFabric fail-closed exposure (outbound, not ours to fix)

The guide's headline SyncFabric finding is **verified and understated**. Facts, all from
`origin/master` `38c429b511`:

- `features.ini` carries `[oAuth2TokenExchangeUriScim20FailClosedEnabled] Enabled=True`, **globally
  and unscoped** (no `appEnvironment` or `slice` qualifier, unlike its neighbours).
- `ConfigurableScim20ConnectorOAuthTokenExchangeClient.IsTokenExchangeUriAllowed` is, in its own
  words, "**Always fail-closed on missing/malformed cscfg**", and is used by PutSecrets and the
  refresh gates **unconditionally**, independent of the exchange-time kill switch.
- Three prod connectors declare `OAuth2AuthorizationCodeGrant`: `amazonbusiness`, `contentstack`,
  `puzzel`.
- Of those, only `amazonbusiness` has a cscfg `oAuth2TokenExchangeUri`
  (`https://api.amazon.com/auth/O2/token`). **`contentstack` and `puzzel` declare none.**
- Additionally, **three connectors declare the setting but leave it empty**: `genetec`,
  `serviceNowScim`, `zoho`. Empty is whitespace, and the predicate is explicitly fail-closed on
  whitespace. The guide missed this class entirely because it only looked for *absent*, not
  *present-but-empty*.

**The tension worth escalating:** SyncFabric's own design doc justifies the global `Enabled=True` with
"AmazonBusiness is the only PROD member" of the configurable code-grant family. The prod connector
configs show three members, plus three more with empty values. **Either the doc's premise is stale or
the connector configs are, and the difference decides whether up to five ISV integrations break.**

**What we cannot determine from static config, and must not assert:** whether `contentstack`,
`puzzel`, `genetec`, `serviceNowScim` and `zoho` actually route through the ConfigurableSCIM20 client
at runtime. That binding is by run-profile tag (`[OAuthExchangeFactory(Tag = ...RunProfileTag)]`), and
which run profiles are live is deployment state, not repository state.

**Action: ask, do not assume.** The precise question for the SyncFabric team is: *"the fail-closed
flag is on globally; five prod connectors have absent or empty `oAuth2TokenExchangeUri`; do any of
them reach `ValidateTokenExchangeUri`?"* This is a question with evidence attached, which is the
useful form. It is **not** an assertion that an incident is in progress.

**For SCIMServer this is inbound risk only**, and it maps to **A15**: our test-ISV scenarios should be
able to model a fail-closed denial, so that when an ISV reports a token-exchange failure we can
reproduce the shape rather than guess at it.

---

## 5. Newly identified items (found by this stock-take)

| ID | Item | Sev | Why it matters |
|---|---|---|---|
| **N1** | **Resolve the phantom v0.55.7.** Docs state "as of v0.55.7 it is base behavior of `StrictSchemaValidation`", but no such version exists in `package.json` or the CHANGELOG | Med | A doc that cites a version that was never cut is unfalsifiable. Either cut 0.55.7 or reword to the version that actually carries the behavior |
| **N2** | **No scheduled liveness probe on any estate.** All 5 scheduled workflows are static gates. `audit-deployment-doc.ps1 -Live` C4 *does* catch a dead estate (verified: exit 1) but only runs post-deploy | High | This is why customer-facing prod being down was found by inspection rather than by alert. A dead estate between deploys is currently invisible |
| **N3** | **`[Unreleased]` has absorbed everything since `0.54.0-alpha.12`** | Med | The CHANGELOG has one heading covering many shipped versions, so it can no longer answer "what changed in 0.55.5?" without reading prose |
| **N4** | **Bind the delivery plan's Section 1 table to item status** (see 1.1) | Med | Second occurrence of the same drift. Manual correction has now failed twice |
| **N5** | **Guide action items cite paths that do not exist** (C4) | Low | Cheap to fix while re-syncing the mirror under A1/A13 |

---

## 6. Non-auth open items

| Item | Detail |
|---|---|
| **Issue #144** (security) | 8 pins in `api/package.json` `overrides` are now themselves vulnerable, e.g. `@hono/node-server@1.19.10` should move to 2.0.5 |
| **Issue #142** (security) | 2 stale `.trivyignore` entries, 14 days overdue, e.g. CVE-2026-4800 (lodash) |
| **Dependabot #146, #147** | 18-package bumps |
| **Dependabot #143, #128** | Older, still open |
| **Customer-facing prod** | Subscription disabled on spending limit; **reactivates automatically 2026-08-21**. Canary prod carries all 58 endpoints meanwhile, so impact is bounded |
| **npm registry TLS block** | `registry.npmjs.org` unreachable machine-wide, so `npm ci` cannot run locally and lockfile regeneration must happen in CI |

---

## 7. What to do next, in order

Sequenced by value per unit of effort, not by wave order.

```mermaid
flowchart TD
    A["A8 audit event<br/>helper exists, 2 handlers, ~1h"] --> B["A12 comment fix<br/>1 line"]
    B --> C["N1 phantom v0.55.7<br/>doc truthfulness"]
    C --> D["W1.2 startup JWKS pre-warm<br/>closes Wave 1"]
    D --> E["A9 + A10 concurrency + partial block<br/>both High"]
    E --> F["A1/A13 merge the guide mirror<br/>861-line gap, needs care"]
    F --> G["N2 scheduled liveness probe"]
    G --> H["W3.5 credential cache + index<br/>unblocks Wave 4"]
    H --> I["Wave 4 RFC 8693"]
```

**Rationale for the ordering.** A8 is first because the helper, the pattern, and three worked
examples already exist, so it is close to pure gain on the most security-sensitive mutation surface
in the product. A12 and N1 are near-free truthfulness fixes. W1.2 is the single item that closes a
whole wave. A1/A13 sits mid-list rather than first despite being marked "blocking", because the
861-line bidirectional divergence means it needs a careful merge, and doing it hastily would lose the
section 0.1 decision record that stopped a declined proposal from being regenerated five times.

**Explicitly not scheduled:** W0.1 and W3.3 are settled decisions, and W5.4 and W6.2 are on-demand
tracks. Scheduling any of them without a new operator decision would be re-litigating a closed
question.

---

## 8. Design and architecture gate disposition

| Check | Finding | Disposition |
|---|---|---|
| SRP | This register reports; it does not own status. Item status stays on the item | **Applied** |
| Coupling | C1/C2 exist because one fact is stored in two places | **Scheduled** as N4 |
| Pattern fit | A8 extends an existing emitter used by three siblings; no new pattern | **Applied** |
| Open/Closed | Section 4's exposure is a config-gated strategy, extended not edited | **Accepted** (SyncFabric-side) |
| YAGNI | No new abstraction proposed. N4 asks to **remove** a duplicated fact, not add a framework | **Applied** |

**R7 self-improvement.** This run revealed that the rule set has no gate binding a summary table to
the detail it summarizes, which is exactly how C1 and C2 recurred after being fixed once. Closed as
**scheduled** (N4) rather than applied, because the right fix is either deleting the duplicated
column or asserting it in CI, and choosing between those needs the operator's view on whether the
summary table earns its keep at all.
