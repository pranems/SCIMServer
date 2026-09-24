# Effective WIF/JWKS egress execution issues and RCA

> **Status:** Reconciled - **Last verified:** 2026-09-24 - **Product version:** `0.55.32`

## Issue dashboard

| ID | Type | Severity | Symptom | Root cause | Resolution | Detection stage | Earliest possible stage |
|---|---|---:|---|---|---|---|---|
| EP-01 | Contract design | High | The UI could display and write raw endpoint numbers but could not answer what value runtime enforcement used or why. | `mergeEgressPolicy()` returned only numbers and discarded endpoint/server/default provenance. | Added one field-spec table and `resolveEffectiveEgressPolicy()`, derived from the existing runtime resolvers. | Design/source audit | Pure resolver RED |
| EP-02 | Contract design | High | Reset to inherit could not remove a stored override. Omitting the key preserved it, while writing `null` failed number validation. | Profile settings supported per-key overwrite but no explicit remove semantic. | Defined `null` as per-key removal in shared profile merge; validation runs only on non-null values and siblings remain intact. | Service RED | Profile-merge unit RED |
| EP-03 | Test harness | Low | A raw CredentialsTab unit mount failed with no QueryClient after the panel added `useEndpointEgressPolicy()`. | The suite mocked endpoint overview/update hooks but not the new query hook. | Added a deterministic no-network hook stub to the existing harness. | Focused Vitest | First integrated component test |
| EP-04 | Process | Low | The initial implementation plan proposed a dedicated DELETE reset route. | The nearby profile merge boundary had not yet been inspected; a second route would duplicate write ownership. | Reused PATCH with explicit null-as-unset semantics, keeping reset parity in one shared merge path. | Local design review | Owning-boundary read |
| EP-05 | Tooling friction | Low | Two newly created test files briefly contained literal leading `+` patch markers. | File content was composed from a diff-shaped draft instead of plain source. | Removed the markers before the first successful compile and added final changed-file syntax/character checks. | Focused compile | Create-file content review |
| EP-06 | Test harness | Low | Mermaid grammar could not resolve `jsdom` and render skipped because the fresh worktree lacked root `node_modules`. | Worktrees do not contain ignored dependencies. | Linked the validated master root dependency tree and reran 714/714 parse/render in both themes. | Docs gate | Worktree setup check |
| EP-07 | Documentation coupling | Medium | The docs gate reported four stale `120 route handlers` claims and one undocumented endpoint. | Adding `GET .../egress-policy` changed the source-derived route inventory. | Updated route count to 121 and added the canonical API entry; content audit passed. | Docs content gate | Same gate immediately after route creation |
| EP-08 | Documentation drift | Medium | The operator guide advertised `JwksCacheMaxAgeMs` server default as 600000 while runtime has enforced 86400000. | A historical default was copied into prose and was not generated from the policy source. | Corrected the guide to 86400000 and documented that the effective API/runtime is authoritative. | Narrative docs audit | Source-derived default table |
| EP-09 | Runtime security/parity | High | Two endpoints sharing one JWKS URI could display different effective policies while the stricter endpoint reused keys cached under the lenient endpoint's TTL and key-count cap. | Cache, single-flight, stale fallback, refresh, and unknown-kid state were keyed only by URI, although all 11 controls are endpoint-specific. | Partitioned all cache behavior by URI plus the complete effective policy fingerprint; redirect resolution remains safely shared by URI. Cross-endpoint RED tests proved the stricter TTL skipped its refetch and `maxKeys:1` accepted two keys before the fix; both pass after. | Independent pre-PR review + focused RED | Two-policy shared-URI unit test |
| EP-10 | Tooling friction | Low | `npm run docs:patterns` failed because no such package script exists. | The pre-push gate invokes `node scripts/check-patterns-pie.mjs` directly; its display name was mistaken for an npm alias. | Ran the actual checker, which correctly required the Category F and total-count updates. | Docs consolidation | Read the pre-push gate command before invoking it |
| EP-11 | Documentation coupling | Low | Fast pre-push blocked because the policy-cache fix changed `external-jwks-validator.service.ts` without changing its coupled authentication guide in the same push. | The first feature commit updated the guide, but F4 evaluates the new push range containing the later runtime fix. | Added the cross-endpoint policy-isolation contract to the authentication guide and reran Fast pre-push. | Fast pre-push docs freshness | Update every coupled user guide in the commit that changes its bound source |
| EP-12 | Runtime performance/parity | Medium | Policy-partitioned cache state made startup prewarm populate only the server-default partition, so endpoints with overrides paid a cold first mint. | `prewarm()` had no override parameter and the boot service deduplicated trusts by URI only. | Prewarm now resolves endpoint settings and warms each distinct URI-plus-policy partition; OAuthModule explicitly imports EndpointModule. | Final independent review + focused RED | Override-aware prewarm test |
| EP-13 | Memory safety | Medium | Successful redirects accumulated forever in `resolvedUri`, outside the bounded JWKS cache. | Redirect canonicalization used an unbounded URI map with no eviction. | Bounded redirect memory to 1,000 LRU entries using the published global cache-entry maximum. | Final independent review + focused RED | Fill-to-bound redirect-memory test |
| EP-14 | Runtime correctness | Low | `cacheMaxAgeMs:0` could reuse a key set when the next verification occurred in the same millisecond. | Freshness used `now > expiresAt` rather than `now >= expiresAt`. | Expire at the exact deadline and lock same-millisecond zero-TTL behavior. | Final independent review + focused RED | Frozen-clock zero-TTL test |

## Prevention

- Effective-state UIs must consume the same resolver used by enforcement.
- Layered values must publish provenance, units, bounds, and requested-vs-effective clamping.
- Inherit/reset semantics must remove stored state explicitly; omission is not removal.
- Route-aware or query-aware component tests must mock every added provider/hook or mount the real provider.
- Inspect the owning merge/write boundary before creating a second management route.
- Run content audits after adding any controller route, and derive operator default tables from the policy source where practical.
- Review plain-source file creation for accidental diff markers before compiling.
- Any endpoint-specific policy applied to shared runtime state must participate in that state's identity; a URI alone is not a sufficient cache or single-flight key.

## Design and architecture disposition

Applied: one egress specification drives the read model, and the existing endpoint PATCH remains the sole settings write surface. The cache key includes the complete effective policy because two real policy variants can share one URI; redirect resolution stays URI-owned. No policy DSL or separate persistence abstraction was added.

## Self-improvement disposition

Applied: unit, E2E, live, and browser tests assert effective values, response key allowlists, persisted removal, inherited source, clamping, and measured viewport bounds. Cross-endpoint shared-URI tests now prove a lenient endpoint cannot weaken a stricter endpoint's cache policy.

## Provenance and completeness

Reconciled against the full uncompacted session transcript from Unit 4B start through final independent PR review. The scan covered RED failures, route/reset design changes, test-harness errors, accidental source markers, stale documentation claims, Mermaid dependency setup, full-suite outcomes, live/browser results, shared-cache policy identity, policy-aware prewarm, redirect-memory bounds, and exact zero-TTL semantics. Search echoes and deliberate negative-control failures were discarded. Verified non-issues: the committed query module exports the egress hook and invalidates it after endpoint writes; all touched files report zero diagnostics; the visual snapshot blob is byte-identical to the index; reset parity passes the six-mode matrix including Prisma E2E; the public read model contains only closed numeric egress fields.
