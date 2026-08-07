# SyncFabric and SCIMServer Authentication Evolution Memory

## Heuristics That Worked

- Reconstruct OAuth form bodies from request builders and tests, not documentation.
- Distinguish committed source, remote source, and working-tree candidate behavior before making claims.
- Compare runtime-file blob SHAs when intervening commits appear unrelated.
- Validate diagrams, structured examples, links, and every referenced source path before declaring the guide complete.
- Inspect the persistence call site and default configuration, not only the redactor/logger, before concluding that credentials cannot be stored.
- Model redirect, retry, timeout, and exponential-backoff work under both default and maximum settings; a per-fetch timeout is not a total request deadline.
- Re-resolve the reference SHA immediately before writing conclusions; a delta analysis that stops short of the reported head leaves a silent gap.
- Bank a delegated sub-agent analysis to a durable file the moment it returns, before doing anything else - it must survive session interruption.
- Grep the consuming repository for citations of your own guide; once a design document is being implemented from, every proposal needs an explicit shipped / partial / open status.
- Derive a repository's effective per-environment posture from flag defaults and slice scoping, not from the presence or absence of an environment name.
- When a delta is small, compute the union of changed paths BEFORE reading any diff. A changed-path set disjoint from the analysed surface proves invariance by construction, which is stronger evidence than a blob-by-blob sample.
- Read the version from `package.json` on the analysed reference. A branch named `release/0.55.0` carried version `0.55.1`.
- Compare a setting against its NEIGHBOURS in the same configuration file. The first-party WIF app ID looked merely unconfigured until the adjacent Graph setting was seen using the identical per-environment override mechanism for sovereign clouds, which turned an absence of evidence into a structural finding.
- Read a durability or reliability fix for its SECURITY consequence. A requeue that stops silently dropping audit rows also makes an unsafe default persist credentials more reliably.

## Anti-Patterns

- Searching only for `WIF` misses first-party, service-principal, connectivity, MSI/FIC, metadata, and app-ID changes.
- Treating requested `/.default` scope as the emitted assertion audience creates incorrect trust configuration.
- Treating assertion `sub` as the ISV-issued OAuth `client_id` hides a real SyncFabric integration-profile distinction.
- Trusting a new research document without rechecking runtime can preserve standards overclaims such as unproven RFC 9068 conformance.
- Treating console-log redaction as proof of persisted RequestLog secrecy misses database, API/UI, export, and backup exposure.
- Treating a JWKS retry count and fetch timeout as a bounded token request misses redirects, sequential trusts, exponential backoff, and cancellation.
- Reading a repository from whichever worktree has the shortest path; confirm which worktree actually has the target branch checked out.
- Reporting supported authentication methods from a registry constant; a registry type without a provider is an advertised lie, not a capability.
- Restating an already-shipped recommendation as outstanding work; it destroys the guide's value as a work list.
- Nesting a fenced JSON or PowerShell block inside a Markdown blockquote when it must be machine-validated; the `> ` prefix breaks parsing.
- Assuming an environment is unsupported because a previous run could not find its selector; selectors get added, and casing bugs can hide them.
- Trusting a delegated sub-agent's NEGATIVE claim. "Nothing consults X", "Y is not implemented", and "there is no cap on Z" are indistinguishable from a failed search. Two such claims were false on 2026-07-31.
- Searching for a subsystem by the vocabulary of the DESIGN DOCUMENT rather than by the data path in code. `profile.authentication.methods` is consulted through `resolveEndpointAuthEnablement`, a name that contains none of the searched terms.
- Correcting a claim in a document's body while leaving the same claim standing in its executive summary. Revision 3 of the guide did this twice.
- Reading a numbered filename suffix as recency. `(2)` was the OLDEST copy of the guide; `(1)` was the middle one; the unsuffixed file was newest.

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
- At SyncFabric `6bd2ac8e86f6e330164eabc689d1a3df4fa48cc5`, the RFC 7523, RFC 8693, and SuccessFactors request builders, 1P mode selection, application IDs, and Graph exposure are unchanged from `f8fa96f4`; only the Google second hop and ISV-onboarding credential placement changed.
- At that SyncFabric revision, `configurableConnectorWorkloadIdentity{,TokenExchange,GoogleWorkspace}Enabled` are globally `Enabled=True`; every first-party flag is slice-scoped to `A`/`B`/`HYBRID1` with default `False`; `credentialLocationInRequestRequiredEnabled` is off except for `isvonboarding` run profiles; `configurableConnectorClientCredentialsScopeEnabled` is slice, tenant, and `isvonboarding` gated.
- At SCIMServer `10e9db229bc0b61e39337b434f9694ef8f30288b`, the token endpoint routes through a pure parser producing a `client_assertion` / `client_secret` / `invalid` union; `client_id` is optional on the assertion variant; RFC 8693 is rejected at the grant-type check.
- At that SCIMServer revision, the issued token's `client_id` is `trust.targetClientId ?? endpointId`, the assertion subject rides `src_sub`, and the lifetime is clamped by both the configured TTL and `assertionExpiresAt`.
- At that SCIMServer revision, `PERSIST_REQUEST_SECRETS` still defaults `true` and `logging-redaction.spec.ts:80-87` asserts that default.
- At that SCIMServer revision, `KNOWN_METHOD_TYPES` holds ten values while four have runtime providers.
- At SyncFabric `c6f63afc37edde087bb6f8be9fbabb5929da736c`, the complete delta from `6bd2ac8e` is two new files under `src/GatewayConfiguration/Delos/`, so every authentication blob is byte-identical to `6bd2ac8e` by construction. The new `serviceconfig` carries no authority, application ID, audience, scope, certificate, or federation setting.
- At that SyncFabric revision, `WorkloadIdentityAuthenticationHelper.CreateClientAuthenticationAccessTokenRequestData` emits exactly `grant_type=client_credentials`, `client_id=<target>`, `client_assertion`, and `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, then merges supplemental fields WITHOUT overriding required ones (duplicate keys are skipped and warned).
- At that SyncFabric revision, `CreateTokenExchangeAccessTokenRequestData` emits only `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, `subject_token`, and `subject_token_type=urn:ietf:params:oauth:token-type:jwt`, and deliberately omits `client_id`.
- At that SyncFabric revision, `microsoftOnlineDirectoryService.workloadIdentityFederationApplicationPrincipalId` in `SyncFabricManager.Packaging.ExpressV2/DeploymentSettings.xml` defaults to the COMMERCIAL app ID `cb1d50fe-...` with exactly ONE `<Value environment="AADSF_DEV_US_ALL">` override to the TME ID. The adjacent `microsoftGraph.rootResource` DOES carry per-sovereign values, so the override mechanism exists and is simply unused for the WIF app ID. First-party mode is therefore commercial-only by configuration.
- At that SyncFabric revision, branch `isvonboarding` is 0 ahead of and 3 behind `origin/master`, so it holds no auth change master lacks.
- At SCIMServer `release/0.55.0` `6e6ad8ffe7521d62132bf013e31373e1bba0183a` (api and web `0.55.1`), `master` `10e9db22` is a strict ancestor: 9 ahead, 0 behind.
- At that SCIMServer revision, `logging.service.ts:124-125` still reads `(process.env.PERSIST_REQUEST_SECRETS ?? 'true')`, and `flushLogs` now UNSHIFTS a failed batch to the front and retries it, capped at `flushMaxBuffer * 10` (default 500), dropping oldest-first past the cap and counting the drops. The P0 disclosure is therefore MORE reliable than before.
- At that SCIMServer revision, `profile.authentication.methods` is consulted at six runtime call sites via `resolveEndpointAuthEnablement`: `endpoint-credential.authenticator.ts:69`, `global-shared-secret.authenticator.ts:93`, `admin-credential.controller.ts:456`, `endpoint-oauth.controller.ts:201`, `discovery/authentication-schemes.ts:81`, `connection-info.service.ts:155`.
- At that SCIMServer revision, the JWKS client FAILS TO STALE, not closed: `external-jwks-validator.service.ts:239-240` serves any cached copy after all fetch attempts fail, with no maximum stale age.

## Superseded Conclusions

- The object-ID-removal experiment in SyncFabric commit `ac8829ca62` was reverted by `df3743d255`; it is not the current customer-mode design.
- SCIMServer source snapshot `0f37e3c7fd056c1b65402db5dc8112cfa1af27f7` was superseded during the first guide run by `25e0a98af6a8370b939cafdf07d813e1808d25fc`.
- SCIMServer snapshot `25e0a98af6a8370b939cafdf07d813e1808d25fc` is superseded as repository provenance by `17b541a46f7ee312e177623592de98af10155c16`, but not by an authentication-runtime behavior change.
- **"No `DELOS` selector exists in source" is FALSE as of 2026-07-31.** `9d2475555b` added Delos federated-identity credential resource identifiers and `6bd2ac8e` fixed their `dataCenter` casing and removed the provisional TODO. They affect first-hop managed-identity acquisition only, never the target wire contract.
- **"SCIMServer ignores request `client_id`" is FALSE as of 2026-07-31.** A mismatched `client_id` is rejected with `wif_client_id_mismatch`; only a *missing* one is still accepted.
- **"SCIMServer conflates assertion `sub` with the issued `client_id`" is FALSE as of 2026-07-31.** Issued `client_id` is `trust.targetClientId ?? endpointId`; the assertion subject is carried separately as `src_sub`.
- **"SCIMServer advertises RFC 8693 it cannot honor" is FALSE as of 2026-07-31.** Metadata is capability-derived and hardcodes `syncFabricRfc8693: false`.
- **"SCIMServer returns HTTP 201 without cache headers" is FALSE as of 2026-07-31.** `@HttpCode(200)` plus `no-store`/`no-cache` shipped.
- **`origin/feat/wif` is no longer a valid SCIMServer baseline** - it was merged into `master`.
- **"The SCIMServer authentication-methods model is inert" is FALSE as of 2026-07-31.** It is consulted at six runtime call sites. The repository documentation that still said otherwise was corrected in the same run.
- **"SCIMServer's JWKS client fails closed on fetch failure" is FALSE.** It fails to stale. The real defect is the absence of a maximum stale age, not the absence of a fallback.
- **"No sovereign WIF application-ID override exists, but values may come from an out-of-band deployment system" is SUPERSEDED.** The setting's own `<Values>` declaration was read: the default is the commercial ID and the only override is TME. The open question is now whether sovereign applications have been registered at all.

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

### 2026-07-31 - Double-sided large-delta refresh

- Scope: delta refresh across a ~86-commit SyncFabric range and a ~90-commit SCIMServer range, followed by targeted revalidation of the affected guide sections.
- SyncFabric source: `f8fa96f4eefb92a077a5ddffd105b77a1b1ae03d` -> `origin/master` `6bd2ac8e86f6e330164eabc689d1a3df4fa48cc5`.
- SCIMServer source: `17b541a46f7ee312e177623592de98af10155c16` -> `origin/master` `10e9db229bc0b61e39337b434f9694ef8f30288b` (API and web `0.55.0`). `feat/wif` merged into `master`.
- **Two SyncFabric wire-contract changes, and only two.** `834c20c512` changed the Google Workspace `generateAccessToken` second hop from form-urlencoded with the customer `Oauth2Scope` to JSON with two fixed Google scopes, isolating the customer scope to the first RFC 8693 hop. `883d3a13b1` defaults ISV-onboarding client credentials to header/HTTP Basic when the credential location is absent, with a configurable `scope`.
- Adjacent SyncFabric defect found incidentally: with `credentialLocationInRequestRequiredEnabled` active, a stored `Both` credential location is no longer rejected and the exact-match conditions emit neither header nor body credentials, producing an unauthenticated request.
- **SCIMServer moved a long way internally and now implements much of this guide.** Shipped since baseline: the strict parsed request union, target-client binding, provenance claims (`jti`, `auth_method`, `src_iss`, `src_sub`, `source_tid/oid/azp`), assertion-capped token lifetime, capability-derived RFC 8414 metadata, HTTP 200 plus `no-store`, and an RFC 8707 resource policy.
- **The P0 credential-persistence defect is still open and got worse.** `PERSIST_REQUEST_SECRETS` still defaults `true`; `logging-redaction.spec.ts:80-87` now *asserts* that default; migration `20260724000000_drop_requestlog_endpoint_fk` lets exposed rows outlive their endpoints. A per-endpoint `PersistRequestSecrets` override now exists but does not change the unsafe default.
- New structural finding: the admin registry accepts ten method types while only four have runtime providers, and SCIM discovery maps all ten - so discovery can advertise a method that cannot authenticate.
- New process finding: SCIMServer source contains 22 citations of this guide's section and wave labels, so the guide is an implementation contract and must carry an explicit status ledger.
- Environment evidence: Delos now exists in source (`DLPROD`, `DLPROD_AD2AAD`, `DLPROD_HR` x `DELOSC`/`DELOSN`). No WIF/1P feature flag has any Delos entry, so Delos inherits globally-enabled target strategies and runs customer-application mode only. No per-sovereign WIF app-ID override exists for FFPROD, USNAT, USSEC, MCPROD, BLPROD, or DLPROD.
- Canonical guide SHA-256: `0C22995445A9DED1D40B176721D7331029D7205A91BFAED2D20D0A039B314C9F`.
- Guide validation: 4,649 lines; 180 balanced fences; 19 JSON examples all parsing; 15 Mermaid diagrams; 2 PowerShell examples; 0 non-ASCII; 0 embedded JWT-like strings; 0 table column mismatches; 47 resolved source paths with 6 explicitly-labelled proposed paths.
- Gap matrix outcome: 9 Done, 4 Partial, 14 Open.
- Repository state: no source-repository changes created; SyncFabric retained its three pre-existing modified files and SCIMServer `master` remained clean.
- Prompt self-edit: v1.2.0 - corrected SCIMServer defaults to `origin/master` and the `SCIMServer-master` worktree, added the range-completeness rule, the large-delta strategy, registry-versus-provider verification, the implementation-contract ledger requirement, and two artifact-verification rules.
- Prompt self-edit: v1.2.1 - frontmatter reduced to the VS Code prompt-file schema (`description`, `mode: agent`), argument hint moved into the body, and a Copilot CLI launcher skill registered at `~/.copilot/skills/syncfabric-scimserver-auth-evolution/SKILL.md`. Surface naming differs (`/syncfabricScimserverAuthEvolution` in VS Code, `/syncfabric-scimserver-auth-evolution` in the CLI) but behavior lives in exactly one file.
- Availability lesson: VS Code derives the slash command from the filename and validates frontmatter against its own schema, while Copilot CLI requires a `SKILL.md` with `name` and `description`. Satisfying both by copying the prompt would create two drifting definitions, so the CLI entry must be a launcher that reads the prompt.
- Process lesson: an analysis delegated to a sub-agent must be banked to a durable file the instant it returns; both delta analyses survived a mid-session interruption only because they had been written out.
- Self-evaluation: source grounding 5/5; contract completeness 5/5; security/performance critique 5/5; environment evidence 4/5 because sovereign authorities and app IDs remain empirical gates; verification 5/5.

### 2026-07-31 - Revision 4: small-delta refresh against a release branch

- Scope: delta refresh across a 1-commit SyncFabric range and a 9-commit SCIMServer range, plus a full
  internal-consistency pass over the guide and a verified rewrite of the SCIMServer documentation-drift ledger.
- SyncFabric source: `6bd2ac8e86f6e330164eabc689d1a3df4fa48cc5` -> `origin/master` `c6f63afc37edde087bb6f8be9fbabb5929da736c`.
- SCIMServer source: `master` `10e9db229bc0b61e39337b434f9694ef8f30288b` -> `release/0.55.0` `6e6ad8ffe7521d62132bf013e31373e1bba0183a` (api and web `0.55.1`). `master` is a strict ancestor, 9 ahead / 0 behind.
- Analysis worktree `C:\Users\v-prasrane\source\repos\SCIMServer-auth-docs` on branch `docs/auth-evolution-refresh-20260731`, created for this run so the operator's `release/0.55.0` worktree was never written to.
- **SyncFabric contract unchanged, and proved rather than sampled.** The whole delta is two new files under
  `src/GatewayConfiguration/Delos/`; the changed-path set is disjoint from every auth path, so all auth blobs are
  byte-identical by construction. The new `serviceconfig` was inspected and carries no auth setting.
- **Sovereign first-party finding (new, high value).** `workloadIdentityFederationApplicationPrincipalId` defaults to
  the commercial app ID with exactly one `AADSF_DEV_US_ALL` override, while the adjacent `microsoftGraph.rootResource`
  in the same file carries per-sovereign values. First-party mode is commercial-only by configuration, not merely by
  flag rollout. Narrows the sovereign empirical gate from "find the IDs" to "have they been registered, and by whom".
- **SCIMServer P0 got more reliable.** `7ce0fa74` made `flushLogs` requeue a failed batch at the front and retry it
  (cap `flushMaxBuffer * 10`, oldest-first drop past cap, drops counted). Correct fix; it removes the accidental
  partial mitigation of the still-default `PERSIST_REQUEST_SECRETS=true`. Remediation must also invert
  `logging-redaction.spec.ts:80-87`.
- **Two delegated sub-agent findings were false and were caught by direct source reading**: "the methods model is
  inert" (six runtime call sites via `resolveEndpointAuthEnablement`) and "JWKS fails closed" (it fails to stale).
  Both are published in guide section 34.4 rather than quietly dropped.
- **Guide self-contradiction found and fixed.** Revision 3 corrected "advertises RFC 8693" and "returns HTTP 201" in
  its body while leaving both in its executive summary. Both bullets deleted with an evidence note.
- **Filename-suffix hazard resolved.** The `(2)` copy was the OLDEST revision-1 seed; `(1)` was revision 2. `(2)` was
  backed up and repurposed as the executive digest and revision ledger; the guide header now carries a revision
  identity table.
- Repository documentation corrected in the worktree: `docs/auth/README.md` (status banner + coverage table + a new
  mirrored-artifact section), `docs/auth/AUTHENTICATION_METHODS_MODEL.md` (inert -> partially active, six call sites),
  `docs/auth/EXTERNAL_JWKS_VALIDATOR.md` (three-layer allowlist; bounds that exist vs bounds that do not),
  `docs/INDEX.md` (version 0.53.0 -> 0.55.1, three mirrored artifacts registered), plus refreshed prompt/memory/guide
  mirrors and removal of a 4,322-line stale numbered duplicate. Nothing committed.
- Artifact hashes at end of run:
  - guide revision 4, 4,960 lines, SHA-256 `20541FA998AE26C7B8ADBD0B86B544E486C764135807FB083E5295178ACF09EB`.
  - digest `(2)`, 191 lines, SHA-256 `0DD31C0549CB84C7F2EEF501E0E7E1ADD67E53CC1087A8050BD3D6546810668B`.
  - resume state, 203 lines, SHA-256 `C29CAA7C57663E2EE3527CA4AA77D303CE23BB333900E58BAD48347DBA872D00`.
  - superseded revision 2 retained as `(1)`, SHA-256 `07557F8F34AF54701785AAEE6A7685CB1A5465A2DD4A255E68E5EA036A97133B`.
- Validation: 20 Mermaid blocks rendered in real headless Chromium under `securityLevel=strict` in both themes,
  mermaid `11.15.0` matching the authoritative VS Code built-in renderer with no drift; 19 of 19 JSON blocks parse;
  190 balanced fences; 48 tables with 0 column mismatches; 0 non-ASCII; 0 em-dash; 2 JWT-shaped strings, both
  illustrative placeholders.
- Repository state: SyncFabric retained its three pre-existing modified files, untouched, and gained nothing. No
  branch switched, stashed, reset, cleaned, or rebased in either repository. No commit amended, no history rewritten.
- Prompt self-edit: v1.3.0 - added 1.3.3 small-delta strategy, 1.3.4 release-branch handling, 4.1.3 verify delegated
  negatives by mechanism not label, and two additions to 10.1 (internal consistency; filename suffixes are not
  recency). Recorded `lastScimServerReference` in metadata.
- Self-evaluation: source grounding 5/5; delta completeness 5/5; current-contract correctness 5/5; 1P depth 5/5 (the
  sovereign finding is new); SCIMServer critique 5/5; persona/environment coverage 4/5 (persona layer still
  unimplemented and unexercised); standards precision 5/5; performance evidence 3/5 - **no latency measurement was
  taken this run, so the deferred action stands: run the WIF token-mint benchmark and replace the modelled numbers in
  guide section 20.8 with measured p50/p95/p99**; security analysis 5/5; migration/reversibility 5/5; artifact
  validation 5/5; prompt and memory improvement 5/5.
- Tail addendum, same run: `release/0.55.0` advanced from `6e6ad8ff` to `edcb330fd47ef69e8a96e2cbdf60fd7013677907`
  while the run was in progress. Re-resolving the reference before writing conclusions caught it, and the tail turned
  out to be the ONLY genuinely auth-plane change of the whole refresh: `SharedSecretGuard.extractEndpointId()` matched
  `/endpoints/<uuid>/` on ANY url, so an endpoint with `SharedSecretBearerAuthEnabled=false` returned 401 on its own
  admin `/overview` and `/stats` routes. Admin-plane routes are now excluded. The tell was that the regex requires a
  TRAILING SLASH, so the sibling `/admin/endpoints/{id}` kept working - two equivalent routes disagreeing points at
  the matcher, not the policy. Invariant to carry forward: the WI-11 per-method enablement family is DATA-PLANE ONLY.
  Final analysed SCIMServer reference for this run: `edcb330f`. Guide section 3.4.0.2.
