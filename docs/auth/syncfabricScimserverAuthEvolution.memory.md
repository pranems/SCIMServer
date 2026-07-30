# SyncFabric and SCIMServer Authentication Evolution Memory

## Heuristics That Worked

- Reconstruct OAuth form bodies from request builders and tests, not documentation.
- Distinguish committed source, remote source, and working-tree candidate behavior before making claims.
- Compare runtime-file blob SHAs when intervening commits appear unrelated.
- Validate diagrams, structured examples, links, and every referenced source path before declaring the guide complete.
- Inspect the persistence call site and default configuration, not only the redactor/logger, before concluding that credentials cannot be stored.
- Model redirect, retry, timeout, and exponential-backoff work under both default and maximum settings; a per-fetch timeout is not a total request deadline.

## Anti-Patterns

- Searching only for `WIF` misses first-party, service-principal, connectivity, MSI/FIC, metadata, and app-ID changes.
- Treating requested `/.default` scope as the emitted assertion audience creates incorrect trust configuration.
- Treating assertion `sub` as the ISV-issued OAuth `client_id` hides a real SyncFabric integration-profile distinction.
- Trusting a new research document without rechecking runtime can preserve standards overclaims such as unproven RFC 9068 conformance.
- Treating console-log redaction as proof of persisted RequestLog secrecy misses database, API/UI, export, and backup exposure.
- Treating a JWKS retry count and fetch timeout as a bounded token request misses redirects, sequential trusts, exponential backoff, and cancellation.

## Verified Cross-Repository Invariants

- At SyncFabric `f8fa96f4eefb92a077a5ddffd105b77a1b1ae03d`, RFC 7523-shaped target requests contain `grant_type=client_credentials`, target `client_id`, Entra `client_assertion`, and the JWT-bearer assertion type.
- At that SyncFabric revision, RFC 8693 requests use a JWT `subject_token`, include connector target parameters, and deliberately omit `client_id`.
- At that SyncFabric revision, first-party application-token scope includes the normalized target DNS host, while presence of `EntraApplicationObjectIdentifier` preserves customer-application mode.
- At SCIMServer `25e0a98af6a8370b939cafdf07d813e1808d25fc`, runtime accepts the RFC 7523-shaped path but does not implement RFC 8693 despite advertising it.
- At that SCIMServer revision, WIF request `client_id` is not independently enforced and connection information conflates it with assertion subject.
- At that SCIMServer revision, its issued JWT is endpoint-scoped but current source does not establish complete RFC 9068 conformance.
- At SCIMServer `17b541a46f7ee312e177623592de98af10155c16`, all reviewed authentication runtime blobs remain unchanged from `25e0a98af6a8370b939cafdf07d813e1808d25fc`; the intervening commit is a shared UI `OverflowMenu`.
- At SCIMServer `17b541a46f7ee312e177623592de98af10155c16`, `PERSIST_REQUEST_SECRETS` defaults true and token-route RequestLog persistence is not unconditionally redacted.
- Current SCIMServer WIF selection orders by unverified issuer but falls back to sequentially trying every trust; JWKS cache entries have no explicit cardinality cap or hard stale-if-error age.
- Current committed SyncFabric source exposes production WIF app ID `cb1d50fe-8ed0-4944-9e7d-5981aad3bc4b` and TME/dev ID `80060f08-85c7-418a-a486-6b36ce053eab`; no per-sovereign WIF app-ID override was established in the reviewed setting.

## Superseded Conclusions

- The object-ID-removal experiment in SyncFabric commit `ac8829ca62` was reverted by `df3743d255`; it is not the current customer-mode design.
- SCIMServer source snapshot `0f37e3c7fd056c1b65402db5dc8112cfa1af27f7` was superseded during the first guide run by `25e0a98af6a8370b939cafdf07d813e1808d25fc`.
- SCIMServer snapshot `25e0a98af6a8370b939cafdf07d813e1808d25fc` is superseded as repository provenance by `17b541a46f7ee312e177623592de98af10155c16`, but not by an authentication-runtime behavior change.

## Open Empirical Gates

- Capture and verify real customer-application and dedicated first-party SyncFabric assertions.
- Confirm current emitted `aud`, `sub`, `oid`, `azp`/`appid`, `roles`, `ver`, and issuer in each acquisition mode.
- Validate the exact Entra resource registration needed by the first-party host-qualified scope.
- Establish measured SCIMServer WIF cold/warm JWKS, multi-trust, database-query, crypto, and issuance latency.
- Discover and validate current first-party application IDs and authorities for every active sovereign environment.
- Inventory existing credential-bearing RequestLog rows, exports, and backups without displaying values; decide cleanup and credential rotation scope.
- Establish intended token-request total deadline, concurrency, and cache/trust cardinality budgets for CI and TME.

## Source and Search Expansion

- Search `WorkloadIdentity`, `first party`, `1P`, `service principal`, mode resolver, app-ID configuration, connectivity parameters, target strategies, feature flags, template reads, provisioning recovery, and auth metadata.
- Include AzureAD SCIMReferenceCode Logic App harness, Microsoft Entra claims guidance, SAP SuccessFactors WIF, OAuth/JWT RFCs, and current vendor target-auth documentation.
- Search request/response persistence defaults, route interceptors, redaction timing, exports/backups, JWKS stale fallback, total deadlines, cancellation, cache cardinality, and maximum endpoint settings.

## Prompt Evolution Proposals

(empty)

## Run Log

### 2026-07-23 - Seed from initial research session

- SyncFabric source: `f8fa96f4eefb92a077a5ddffd105b77a1b1ae03d`
- Latest WIF-specific commit then found: `b0395434354198f90db61f494428417353ddfd65`
- SCIMServer source: `25e0a98af6a8370b939cafdf07d813e1808d25fc`
- Canonical guide SHA-256: `532894BA24E123C0B3A7D056437E357FB895D37B73E50106D06B357575C4385F`
- Main findings: two SyncFabric acquisition modes, RFC 7523 and RFC 8693 target profiles, first-party host-qualified scope and service-principal provisioning, mature SCIMServer JWKS/trust primitives, and important SCIMServer runtime/metadata/client-binding gaps.
- Validation: 13 Mermaid diagrams, 16 JSON examples, 2 PowerShell examples, and 37 source paths validated in the initial guide run.

### 2026-07-23 - Latest-source auth-evolution refresh

- Scope: delta refresh followed by full revalidation of touched WIF, 1P, endpoint-persona, security, performance, environment, workflow, and implementation conclusions.
- SyncFabric source: `origin/master` remained `f8fa96f4eefb92a077a5ddffd105b77a1b1ae03d`.
- SCIMServer source: `origin/feat/wif` advanced to `17b541a46f7ee312e177623592de98af10155c16`; authentication runtime blobs were unchanged.
- Material findings: default persisted request logs can retain assertions/tokens/secrets; unknown issuer can multiply sequential trust/JWKS work; stale/error and cache/cardinality bounds are incomplete; endpoint emulation should use finite versioned auth personas separate from schema, trust, environment, and fault profiles.
- Environment evidence: commercial production and TME WIF app IDs are source-backed; Fairfax, USNat, USSec, Mooncake, Bleu, and dedicated-environment IDs/authorities remain empirical gates. No `DELOS` selector was found in the reviewed `features.ini`.
- Canonical guide SHA-256: `07557F8F34AF54701785AAEE6A7685CB1A5465A2DD4A255E68E5EA036A97133B`.
- Guide validation: 4,318 lines; 15 Mermaid diagrams; 18 JSON examples; 2 PowerShell examples; 42 existing source paths; 7 clearly proposed paths; 88 fenced code blocks; headings, tables, links, fences, ASCII, and secret patterns checked.
- Repository state: no source-repository changes created; SyncFabric retained three pre-existing modified files and SCIMServer remained clean.
- Prompt self-edit: v1.0.1 adds total-deadline/cardinality checks and mandatory route-level pre-persistence redaction proof.
- Self-evaluation: source grounding 5/5; contract completeness 5/5; security/performance critique 5/5; environment evidence 4/5 because real sovereign values remain unavailable; verification 5/5.
