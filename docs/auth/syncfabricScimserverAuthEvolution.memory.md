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
- Work the invariance tiers in order and stop at the first proof: changed-path union disjoint from the surface (proof by construction) -> blob SHAs for EVERY file matching the surface pattern (byte-level proof) -> read diffs. Comparing only the files in the diff proves nothing about the files that are not.
- When a delta changes nothing, spend the recovered effort on evidence the delta could never supply: newly committed proofs and captures, unmerged branches, documentation drift, stale mirrors, and citation counts. Run 5's three best findings all came from there.
- Check unmerged branches by ahead/behind count and changed paths before reading anything. A branch whose name contains no auth vocabulary carried a new architectural axis; two named `fix/profile-enforcement-*` were 0 ahead and empty.
- Enumerate EVERY copy of the guide and read each header's revision number before the first edit. The canonical path is not necessarily the newest copy.
- When a claim about a token's shape can be settled by a committed capture, prefer the capture over any amount of reasoning - and then state precisely what the capture's own configuration does NOT cover.
- Resolve an author or keyword hint against the baseline before reporting presence or absence. Search the delta, and if empty search the FULL history and compare dates. "This work is real, dated A to B, predates the baseline, already analysed in sections N and M" is a complete answer.
- When runtime blobs are invariant, keep looking at the **configuration plane**: per-section merge semantics, concurrent-write safety, structured audit coverage, and doc-versus-implementation agreement. Run 6's most consequential finding came from there while both token runtimes were byte-identical.
- Verify a merge/replace rule by reading the merge function, not by trusting the commit message that claims to document it. The message was right in run 6, but the three follow-on defects were only visible in the source.


### Added 2026-08-19 (run 7)

- **Compare blobs, not file sets.** Run 7's headline SyncFabric finding lived in 2 files out of an
  identical 77-file surface, inside a 112-commit delta. Nothing about the file list hinted at it. The
  phrase "the auth surface is unchanged" must always mean *blob-identical*, never *same membership*.
- **Read a feature flag's `features.ini` section body, not just its name.** A section containing a
  bare `Enabled=True` with no `appEnvironment:`/`slice:` qualifier is **globally on**. Neighbouring
  sections in the same file that do carry qualifiers make the absence meaningful, not accidental.
- **Follow a config-driven gate to the entity list.** Once a gate reads a configuration value, the
  useful question is never "does the code deny?" but "which configured entities lack the value?".
  For SyncFabric that meant: cscfg declares 27 connectors, `DeploymentSettings.xml` populates 24,
  three are empty, and separately two auth-code-grant connectors have no entry at all.
- **`IsRequired = false` on a ConfigurationProperty is a fail-closed hazard.** It converts "absent"
  from a load-time error into a runtime empty string, which is precisely the input a newly
  fail-closed predicate denies.
- **A source comment explaining why a change was made is high-value evidence.** SCIMServer's
  `JwksHostNotPermittedError` doc-comment states the security reasoning (revocation must not inherit
  fail-to-stale, and a 144x TTL increase widened the window) far more precisely than the diff does.
  Read the comments in changed files before reasoning about intent.
- **Check the counterpart repository for work you are about to redo.** A WIF token-mint latency
  analysis existed in SCIMServer while this workflow carried it as a deferred gate for four runs.
- **When two copies of an artifact diverge, resolve per-region, not per-file.** Operator edits in the
  mirror are authoritative; analysis content in the canonical copy is authoritative. Picking a single
  winner destroys one of the two.
## Anti-Patterns

- Carrying a repository count forward as prose instead of re-deriving it. Run 5's "78 of 78" was 77 at every commit; the verdict was right so nothing ever forced a re-check, and the wrong number survived a full revision.
- Enumerating a file surface at HEAD and comparing backwards without also diffing the two file LISTS. Deleted and renamed files never enter the enumeration and are silently reported as unchanged.
- Assuming an authentication keyword hit is authentication-relevant. `ApplicationIdentifierDelos` is a ConnectedDirectory identifier for CloudSync, not an Entra app ID. Classify by declaring type and plane, and record cleared false positives with their reason.
- Anchoring an `edit` insertion on a section heading and omitting that heading from the replacement. It deletes the heading while leaving the body, and no fence/table/anchor/ASCII check can see it. Compare the level-2 section inventory after any structural edit.
- "Fixing" the document when the validator is what is wrong. The table checker split on Markdown-escaped `\|` and reported two false failures; editing the document to satisfy it would have corrupted correct Markdown. Establish which of the two is wrong before changing either.
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
- Reading a file's LOCATION as recency. On 2026-07-31 the canonical session `files/` copy was revision 3 while revision 4 lived only inside a git worktree; editing the file found at the canonical path would have silently reverted a whole revision.
- Writing `git diff $prev..origin/master` in PowerShell. `$prev..origin` parses as member access, producing a git usage error that is easy to misread as an empty diff. Build the range string first.
- Assuming a service is migrating uniformly toward federated credentials. SyncFabric added a static-IAM-key connector family while the WIF programme was in flight; it is federating the SCIM target surface, not everything.
- Reasoning generically about credential handling from a credential-type enum. `KnownSecretType.ClientIdentifier` now carries an AWS access key ID and `Server` carries a region.
- Defining a gate without defining how it fails. SCIMServer `d55faf97` fixed a live-test gate that could never fail a deployment - assurance paperwork with no assurance.
- Recording an artifact hash computed over newline-translated text. A Python read with universal newlines and a `Get-FileHash` on the same file produce different SHA-256 values; always record the on-disk byte hash.
- Keying a replay denylist on `jti` for Entra tokens. Entra emits `uti`; a `jti` denylist would silently never match.
- **Using `git rev-parse <rev>:<path>` to compare blobs without first checking the path exists.** On a bad path it prints the INPUT STRING to stdout and exits 128, so two bad paths compare as UNEQUAL and the check reports a false CHANGED. This produced two false "CHANGED" verdicts on 2026-08-04, one of which directly contradicted a correct blob scan in the same run. Always `git cat-file -e <rev>:<path>` first, or enumerate with `git ls-tree` so the paths are real by construction.
- Recording a source path in memory from recollection rather than from `git ls-tree`. Three auth paths carried in memory (`api/src/modules/scim/auth/...`) do not exist; the real ones are `api/src/oauth/` and `api/src/modules/auth/authenticators/`. A wrong path combined with the rev-parse trap above manufactures a confident, entirely fictional delta.

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
- At SyncFabric `ac6fb8667cc753e2960003aa611bca803e9dcd1d`, ALL **77** files matching `WorkloadIdentity|TokenExchange` are byte-identical to `c6f63afc`. Every authentication conclusion at `c6f63afc` holds unchanged. (Run 5 recorded this as 78; corrected in run 6 after re-deriving 77 at `c6f63afc`, `ac6fb866`, and `da0c7b46`. The verdict is unaffected - it came from a blob comparison, not from the count.)
- At SyncFabric `da0c7b46f16882b17d40a8e7386cce22e4fdb7ee`, ALL **77** of the same files are byte-identical to `ac6fb866`, with 0 deleted and 0 renamed. The authentication runtime is now invariant across two consecutive refreshes and 29 commits.
- At SCIMServer `21ca0a95557be1cb643f1b7d9da4a05897843f36`, ALL **92** files under `api/src` matching `oauth|auth|jwks|wif|token|credential` are byte-identical to `e741c373`. The token runtime, assertion validation, JWKS handling, and credential persistence are unchanged - so every invariant established at `e741c373` holds by construction, including the open P0.
- SCIMServer `profile.authentication` is **replaced wholesale** on PATCH while `profile.settings` and `serviceProviderConfig` are **per-key merged**, and any section absent from the partial is preserved. Verified in `mergeProfilePartial`, `api/src/modules/endpoint/services/endpoint.service.ts`. The two auth-affecting surfaces therefore have opposite semantics in the same request body.
- At that SyncFabric revision, `src/dev/Controller/RunProfile/AwsIdentityCenter/` is a NEW non-federated auth family: `BasicAWSCredentials` from static IAM keys plus STS `AssumeRole` with the fixed `RoleSessionName = "SyncFabricIdentityDiscovery"`, gated by `awsIdentityCenterDiscoveryEnabled` (`Enabled=False` globally; `slice:A|B|HYBRID1|HYBRID0=True`). It does not touch the SCIM target wire contract.
- At SCIMServer `e741c3738a2670f4de6e60351af152f11425af84` (api and web `0.55.1`), the 13-commit delta from `edcb330f` contains **zero** files under `api/src/`, `api/prisma/`, or `web/src/`. Every SCIMServer authentication conclusion at `edcb330f` holds by construction, including the open P0.
- At that SCIMServer revision, `master`, `release/0.55.0`, and `feat/wif` are the SAME commit.
- At that SCIMServer revision, `docs/auth/WIF_END_TO_END_PROOF_AND_AUTH_METHOD_REFERENCE.md` records a real no-mock Entra end-to-end proof; `origin/feat/per-endpoint-tls-policy` (`696b9bff`, 4 ahead) adds nginx-level SNI TLS profiles with no `api/src` change; `docs/auth/...GUIDE (1).md` is a stale revision-2 mirror.
- At SCIMServer `21ca0a95` (api and web `0.55.2`), the 6-commit delta from `e741c373` changes 46 files, of which 7 are under `api/src` and NONE are on the auth surface. A blob compare of ALL **124** files matching `oauth|wif|trust|jwks|credential|guard|token|assertion|auth` shows **0 changed, 0 added, 0 removed**. Every SCIMServer authentication conclusion at `e741c373` holds by construction, including the open P0.
- At that SCIMServer revision, `41c293cc` corrected the PATCH profile merge **documentation only**: `mergeProfilePartial` already performed a per-key merge of `serviceProviderConfig`, and `authentication` is replaced **wholesale** when present (`endpoint.service.ts:811-813`), annotated "A1" because the admin authentication-methods API computes and submits the full block. Runtime behaviour is unchanged; the prior comments and DTO docstring were simply wrong.
- At that SCIMServer revision, `external-jwks-validator.service.ts:240-247` still returns `this.cache.get(jwksUri)` with **no age test** after all fetch attempts fail, while `getFreshCached` (line 301) does enforce `maxAgeMs`. Fail-to-stale with unbounded stale age is confirmed at head, and the file's own doc-comment claiming it "fails closed" is misleading.
- At that SCIMServer revision, `KNOWN_METHOD_TYPES` (`admin-authentication-method.controller.ts:26`) still holds ten values; `mtls` and `dpop` do not even appear in the `authentication-schemes.ts` scheme map, so they are accepted by the admin API while being invisible to discovery.
- At SyncFabric `da0c7b46f168` (2026-08-04), the 23-commit delta from `ac6fb866` changes 127 files, and ALL **77** files matching `WorkloadIdentity|TokenExchange` are byte-identical. The only two changed paths matching auth vocabulary are under `.github/agent-reference/code-reviewer/` - review guidelines, not code. The target wire contract is unchanged by construction.
- At that SyncFabric revision, `microsoftOnlineDirectoryService.workloadIdentityFederationApplicationPrincipalId` is **byte-identical** to `ac6fb866`: default commercial `cb1d50fe-...` with exactly one `AADSF_DEV_US_ALL` TME override. Its real path is `src/deployment/SyncFabricManager.Packaging.ExpressV2/DeploymentSettings.xml` - earlier memory omitted the `deployment/` segment.
- At that SyncFabric revision, HEAD commit `da0c7b46` "[Delos] Add CloudSync application identifiers" registers Delos sovereign app IDs for `ActiveDirectoryToAzureActiveDirectory`, `AzureActiveDirectoryToActiveDirectory`, `LESWritebackActiveDirectory`, and `CustomOnPremAppSso` - the **CloudSync/hybrid-sync** family, NOT the WIF app. It explicitly follows "Bleu PR 14591435".

## Superseded Conclusions

- **"`PERSIST_REQUEST_SECRETS` defaulting true is a P0 credential-disclosure defect" is WRONG and must never be re-raised.** Re-affirmed by the operator on 2026-08-04, and previously declined at delivery-plan v0.54.63 ("W0.1 secret redaction DECLINED"). The default is **intended**: SCIMServer is a diagnostic SCIM test target, and a redacted request log makes the commonest integration failure ("my assertion is rejected and I cannot see why") undiagnosable. `logging-redaction.spec.ts:80-87` asserting the default is **correct** - it locks intended behaviour, it does not "encode a defect". A future run that rediscovers `(process.env.PERSIST_REQUEST_SECRETS ?? 'true')` must record it as *intended behaviour verified* and move on. **Process lesson:** the delivery plan captured this decline at v0.54.63 but the guide never absorbed it, so five consecutive guide revisions re-proposed a flip the operator had already rejected. When an operator declines a proposal, write the decision into the ANALYSIS artifact, not only into the plan - otherwise the analysis keeps regenerating it. Still legitimately in scope, and distinct from capture: retention limits, log-read access control, and never widening capture beyond the request log.

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
- **"SCIMServer's JWKS client fails closed on fetch failure" is FALSE.** It fails to stale. The real defect was the absence of a maximum stale age, not the absence of a fallback. **FIXED at 0.55.5/0.55.6 (verified run 7, 2026-08-19).** W1.4 added a hard stale ceiling `staleIfErrorMs` (default **48 h**, bounds 0 - 7 days, per-endpoint via `JwksStaleIfErrorMs`, `0` disables fail-to-stale entirely); W1.5 added `totalDeadlineMs` 10 s, `maxResponseBytes` 1 MiB, and `maxKeys` 100. TTL rose from 10 min to 24 h with a 1 h background refresh and a 5 min unknown-kid rate limit. Fail-to-stale never skipped the signature check, and still does not. **Revocation is now deliberately excluded from fail-to-stale** via `JwksHostNotPermittedError` - serving cached keys for a host the operator revoked would make a security action a no-op for the whole cache lifetime.

- **"`PERSIST_REQUEST_SECRETS` is a P0" was recorded as superseded in THIS FILE during run 6, and run 6's guide still carried 14 P0 references anyway.** This is a distinct failure from the original one and is worth its own entry: *recording a supersession in memory does not discharge it.* The artifact must be swept for the superseded claim in the same run, and the sweep must be verified by a count, not by intention. Run 7 performed the sweep and reduced the count to zero live references, retaining only historical mentions that explicitly label themselves as withdrawn. **New gate 13 below.**
- **"No sovereign WIF application-ID override exists, but values may come from an out-of-band deployment system" is SUPERSEDED.** The setting's own `<Values>` declaration was read: the default is the commercial ID and the only override is TME. The open question is now whether sovereign applications have been registered at all.

## Open Empirical Gates

> Status refreshed 2026-08-19 (run 7). Gates closed by real evidence are listed as CLOSED and
> retained so a future run does not reopen them; see guide section 37.4 for the authoritative table.

- **CLOSED** - shape of an Entra v2.0 app-only assertion: `aud` = bare app-id GUID, `sub` == `oid`, `azp` present, `ver` = `2.0`, no `roles`, `uti` not `jti`.
- **CLOSED** - whether `/.default` appears in `aud`: it does not.
- **CLOSED 2026-08-19** - SCIMServer JWKS maximum stale age. `staleIfErrorMs` default **48 h**, bounds 0 - 7 days, per-endpoint `JwksStaleIfErrorMs`, `0` disables fail-to-stale. Was open since revision 1.
- **CLOSED 2026-08-19** - SCIMServer JWKS response byte/key caps and total deadline: 1 MiB, 100 keys, 10 s.
- **OPEN, NEW 2026-08-19** - Whether SyncFabric's globally enabled fail-closed token-exchange gate is denying live traffic. Source shows `oAuth2TokenExchangeUriScim20FailClosedEnabled` is `Enabled=True` with no environment or slice qualifier, that `IsTokenExchangeUriAllowedCore` now returns `false` on missing cscfg, and that two of three prod auth-code-grant connectors (`contentstack`, `puzzel`) have **no** `oAuth2TokenExchangeUri` configured. Cheapest resolution: query telemetry for `WarningScim20ValidateTokenExchangeUriDenied` with reason `CscfgUriMismatchOrMissing`. Do **not** escalate this as an incident without that evidence - deployed cscfg may differ from the committed file and these connectors may carry no traffic.
- **OPEN, NARROWED** - SyncFabric's own first-party `azp`, `oid`, `sub`, and the `aud` produced by the host-qualified scope. The capture used a synthetic app with a client secret (`azpacr: "1"`), not SyncFabric's MI/FIC path. Checking `azpacr` on a real SyncFabric assertion is the cheapest way to confirm which acquisition path ran.
- Capture and verify a real SyncFabric RFC 8693 exchange; none exists on either side.
- Validate the exact Entra resource registration needed by the first-party host-qualified scope.
- Establish measured SCIMServer WIF cold/warm JWKS, multi-trust, database-query, crypto, and issuance latency. **Four runs overdue - but read `SCIMServer` commit `6504626e` ("docs: WIF token-mint latency analysis (X11)") FIRST; the measurement may already exist and simply was never absorbed.**
- **OPEN, SHARPENED 2026-08-04** - Determine whether sovereign first-party WIF applications have been registered at all, and who owns registering them. The question is no longer "does anyone register sovereign app IDs": SyncFabric `da0c7b46` registered **Delos** CloudSync application identifiers across four directory-identifier classes, explicitly following "Bleu PR 14591435". The sovereign-registration process demonstrably exists, is active, and has now been applied to Bleu and Delos for the hybrid-sync family - while `workloadIdentityFederationApplicationPrincipalId` stays commercial-default with a single TME override. The missing sovereign WIF app ID is therefore a **gap in an otherwise-exercised process**, not an unknown. Ask the CloudSync identifier owners who performs the registration and why WIF was excluded.
- Inventory existing credential-bearing RequestLog rows, exports, and backups without displaying values; decide cleanup and credential rotation scope.
- Establish intended token-request total deadline, concurrency, and cache/trust cardinality budgets for CI and TME.
- **OPEN, NEW 2026-08-04** - Determine whether any SCIMServer endpoint has already lost authentication methods to a partial `profile.authentication` PATCH or to two concurrent method adds. This gate is **self-obscuring**: wholesale replacement plus no optimistic concurrency plus no structured audit event means the loss leaves no record. The audit fix (guide action A8) is a prerequisite for answering it, not merely a hardening item.
- Every gate above must be given a demonstration that it can FAIL before it is treated as satisfied. For merge/replace semantics specifically, the demonstrating test must use a **strict-subset** partial - a complete partial makes both candidate behaviours produce identical output.
- **Gate 13, added 2026-08-19.** When this memory records a conclusion as superseded or a proposal as declined, the same run must **sweep the guide for live references to it and report the resulting count**. Run 6 wrote the `PERSIST_REQUEST_SECRETS` supersession into this file and left 14 P0 references standing in the guide. Recording a supersession does not discharge it; only a counted sweep does. Historical references are permitted **only** when they explicitly label themselves as withdrawn.

## Source and Search Expansion

- Search `WorkloadIdentity`, `first party`, `1P`, `service principal`, mode resolver, app-ID configuration, connectivity parameters, target strategies, feature flags, template reads, provisioning recovery, and auth metadata.
- Include AzureAD SCIMReferenceCode Logic App harness, Microsoft Entra claims guidance, SAP SuccessFactors WIF, OAuth/JWT RFCs, and current vendor target-auth documentation.
- Search request/response persistence defaults, route interceptors, redaction timing, exports/backups, JWKS stale fallback, total deadlines, cancellation, cache cardinality, and maximum endpoint settings.
- Search `AwsIdentityCenter`, `AssumeRole`, `BasicAWSCredentials`, `RoleSessionName`, `KnownSecretType`, and `AssumeRoleWithWebIdentity` for non-Entra credential families in SyncFabric.
- Search SCIMServer for `azpacr`, `uti`, `docker/tls13`, `tls-sni-policy-probe`, `WIF_END_TO_END_PROOF`, and `.doc-manifest.json` / `audit-doc-content.mjs` (its docs-freshness gate).
- Grep both repositories for stale MIRRORS of this workflow's own artifacts - guide, prompt, and memory - and compare sizes against the canonical files; run 4's refreshed mirrors were never committed and mainline still serves revision-2 content.

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

### 2026-07-31 - run 5 - double-sided invariance run

- References: SyncFabric `c6f63afc37edde087bb6f8be9fbabb5929da736c` -> `origin/master`
  `ac6fb8667cc753e2960003aa611bca803e9dcd1d` (6 commits). SCIMServer `edcb330fd47ef69e8a96e2cbdf60fd7013677907`
  -> `origin/master` `e741c3738a2670f4de6e60351af152f11425af84` (13 commits, api/web `0.55.1`). Both prior
  snapshots confirmed strict ancestors.
- Scope: delta, all auth methods, guide-only writes.
- **Both authentication runtimes are unchanged, and both verdicts are proofs.** SyncFabric: all **77** files
  matching `WorkloadIdentity|TokenExchange` compared by blob SHA - 77 identical, 0 changed. SCIMServer: the
  13-commit changed-path union filtered to `api/src`, `api/prisma`, `web/src` is **empty**.
  (This entry originally said 78; corrected in run 6. See "a surface cardinality is a measurement".)
- Three apparent SyncFabric config hits cleared individually: `DeploymentSettings.xml` gained only two
  `scheduler.*` `AADSF_DEV_US_ALL` overrides (`workloadIdentityFederationApplicationPrincipalId` untouched, so
  the run-4 sovereign finding still stands); the `features.ini` diff has **zero** lines matching
  `workloadIdentity|firstParty|credentialLocation|clientCredentials|tokenExchange|oauth|assertion`;
  `FeatureConfigurationSection.cs` added three non-auth constants.
- **Finding 1 - a new SyncFabric auth family that moves AWAY from federation.** `2d7fde9b` (Aditya Gupta) added
  `src/dev/Controller/RunProfile/AwsIdentityCenter/`: `BasicAWSCredentials` from long-lived static IAM keys, then
  STS `AssumeRole` per member account. Four critiques published: static secrets while WIF exists to remove them
  (AWS supports `AssumeRoleWithWebIdentity`, so this is a design choice not a platform limit); `KnownSecretType`
  semantically overloaded (`ClientIdentifier`=access key, `ClientSecret`=secret key, `Server`=region,
  `InstanceName`=role name); fixed `RoleSessionName = "SyncFabricIdentityDiscovery"` destroys per-tenant
  CloudTrail attribution; per-account credential memo has no expiry against a 1 h default session. Rollout
  `Enabled=False` globally with `slice:A|B|HYBRID1|HYBRID0=True`.
- **Finding 2 - a new persona axis below the application.** `origin/feat/per-endpoint-tls-policy` (`696b9bff`,
  4 ahead) adds SNI-routed TLS profiles and a TLS 1.3-only stack under `docker/tls13/` with **no `api/src`
  change** - enforcement is nginx. Guide gained section 11.9.1: transport is an independent axis that composes
  with every auth method for free, and whose failures emit nothing at the token endpoint.
- **Finding 3 - empirical gates CLOSED by real Entra evidence.** SCIMServer now commits
  `docs/auth/WIF_END_TO_END_PROOF_AND_AUTH_METHOD_REFERENCE.md`, a no-mock end-to-end proof. Decoded assertion:
  `aud` is the **bare app-id GUID** even though the requested scope was `api://<appId>/.default` - this
  definitively settles the `/.default` question the guide had carried since revision 1; `sub == oid`;
  `azpacr: "1"` (= client authenticated with a shared secret) is a newly usable credential-strength
  discriminator; **no `roles`**; **no `jti`** - Entra emits `uti`, which constrains any replay-denylist design.
  Caveat recorded: the capture used a synthetic app with a client secret, not SyncFabric's MI/FIC path, so the
  claim SHAPE is closed while SyncFabric-specific VALUES stay open.
- Revision-identity failure caught and corrected: the canonical session `files/` copy held **revision 3**
  (4,649 lines, SHA-256 `0C229954...`) while **revision 4** (5,023 lines, SHA-256 `2905110A...`) existed only in
  the `SCIMServer-auth-docs` worktree. Verified rev 4 was a strict superset (all 35 rev-3 H2 sections present
  plus one new) before promoting it, and preserved rev 3 as `SUPERSEDED_rev3_GUIDE.md`.
- Guide citations 22 -> **28**, six now in `api/src` runtime code. SCIMServer mainline still carries
  revision-2-era mirrors of the guide, prompt (38 KB vs 52.7 KB) and memory (8 KB vs 27.5 KB) because run 4's
  edits were never committed; recorded as blocking action A1.
- `d55faf97` "fix(gates): live-test could never fail a deployment" motivated new prompt section 9.4.
- Two SCIMServer branches named `fix/profile-enforcement-*` are **0 ahead** of master and carry nothing.
- Artifact: guide **revision 5**, 5,471 lines, 271,095 bytes on disk, SHA-256
  `AD9FA4115644D41E5076CAD4A7E91BF0EB4DBF5C7C069BE5738F37E04E5A8194` (file bytes, CRLF, via
  `Get-FileHash`). **Gotcha recorded:** a Python validator reading the same file with universal-newline
  translation produced `DA4EC7E984...` over 265,625 LF-normalised bytes. Two different hashes for one
  file is exactly the ambiguity a recorded hash exists to prevent, so the authoritative value is always
  the on-disk byte hash.
- Validation: 20/20 Mermaid diagrams parse under the **real** `mermaid.parse()` engine (v11, JSDOM host);
  20/20 JSON blocks parse; 100 balanced fences; 0 table column mismatches; 0 broken internal anchors; 0
  non-ASCII; 0 em-dash; 0 fenced blocks nested in blockquotes; 2 JWT-shaped strings, both decoded and confirmed
  to be placeholders containing only `"..."`; 82 backticked repository paths checked, 13 unresolved and all
  either proposed/labelled, URL templates, or deliberately elided.
- Repository state: SyncFabric on branch `opentext` (0 ahead / 0 behind master) with four pre-existing modified
  files, untouched. All four SCIMServer worktrees untouched, including the eight pre-existing dirty entries in
  `SCIMServer-auth-docs`. No branch switched, stashed, reset, cleaned, or rebased. No commit created or amended.
- Prompt self-edit: v1.4.0 - added 1.3.5 prove invariance before reading diffs, 1.3.6 a zero-change run is a
  result, 1.3.7 check unmerged branches by content, 4.1.4 a new auth family may move away from federation, 4.1.5
  credential-type enums get overloaded, 9.4 a gate must be able to fail, a PowerShell `$var..sha` hazard note in
  1.2, and extended 10.1 from "filename suffixes are not recency" to "location is not recency".
- Self-evaluation: source grounding 5/5; delta completeness 5/5 (byte-level proof on both sides);
  current-contract correctness 5/5; 1P depth 4/5 (re-confirmed, not advanced - no new 1P source landed);
  SCIMServer critique 5/5; persona/environment coverage 5/5 (transport axis is genuinely new);
  standards precision 5/5 (the `/.default` question is now measured rather than reasoned); performance evidence
  **3/5 - still no latency measurement; the deferred action from run 4 stands unchanged and is now two runs old:
  run the WIF token-mint benchmark and replace the modelled numbers in guide section 20.8 with measured
  p50/p95/p99**; security analysis 5/5; migration/reversibility 5/5; artifact validation 5/5; prompt and memory
  improvement 5/5.
tion 5/5; prompt and memory
  improvement 5/5.

### 2026-08-04 - Run 6, delta stock-take (no guide edit)

- Trigger: operator asked to sync `feat/wif` with `origin/master`, then take stock against latest sources.
- SyncFabric: `ac6fb866` -> `da0c7b46f168` (23 commits, 127 files). Auth surface **invariant by construction** - all 77 `WorkloadIdentity|TokenExchange` blobs byte-identical.
- SCIMServer: `e741c373` -> `21ca0a95` (6 commits, 46 files; api+web `0.55.1` -> `0.55.2`). Auth surface **invariant** - all 124 auth-matching blobs byte-identical.
- `feat/wif` fast-forwarded to `21ca0a95` and pushed; 0 ahead / 0 behind `origin/master`. It remains an alias of mainline, not a divergent branch.
- Best new finding: `da0c7b46` proves the sovereign app-ID registration process is ACTIVE (Delos CloudSync identifiers, following Bleu), which converts the sovereign-WIF gate from "unknown whether anyone registers these" into "a gap in a process that is demonstrably being exercised for other app families".
- Guide NOT edited - the operator asked for a stock-take, and both snapshots are runtime-invariant, so revision 5's conclusions all still hold. Only the two snapshot SHAs and the sovereign-gate framing are now stale in the header.
- Two self-inflicted false deltas this run, both from `git rev-parse <rev>:<path>` on a non-existent path echoing its input and exiting 128. Caught only because a correct blob scan disagreed. New anti-patterns recorded.
- Canonical guide confirmed: OneDrive unsuffixed copy, revision 5 content, 5470 lines, byte-matching the session-state copy. `(1).md` copies (4318 / 4322 lines) remain stale revision-2 mirrors, including the one vendored in the SCIMServer repo.

### Run 6 - 2026-08-04

- Baselines: SyncFabric `ac6fb866` -> `da0c7b46f16882b17d40a8e7386cce22e4fdb7ee` (23 commits, 127 paths);
  SCIMServer `e741c373` -> `21ca0a95557be1cb643f1b7d9da4a05897843f36` (6 commits, 46 paths, v0.55.1 -> v0.55.2).
  Both prior snapshots confirmed strict ancestors. Scope: delta, all auth methods, guide-only writes.
- **First asymmetric run.** SyncFabric produced 23 commits with zero authentication change; SCIMServer
  produced 6 commits with zero token-runtime change but a real change to how authentication
  *configuration* is merged. "Runtime unchanged" and "authentication behaviour unaffected" were not the
  same statement for the first time.
- SyncFabric: **77 of 77** auth-surface blobs identical, 0 deleted, 0 renamed. `features.ini` diff has
  **zero** lines matching the auth vocabulary; its three new blocks are all non-auth.
- SCIMServer: **92 of 92** `api/src` auth-surface blobs identical. 7 runtime files changed - 3 endpoint
  module, 1 DTO, 3 supply-chain gate scripts. Tests 4673 -> 4675.
- **The Ramsey Ali hint resolved to already-analysed work.** His WIF commits span 2026-06-24 to
  2026-07-24, all at or before the run-5 baseline: `03a94b0a77`, `c1ef938fb3`, `36df2850ef`/`43c7fd49e9`,
  `9fa309bf39`/`b039543435`. Reported as "already covered, here is where" rather than re-derived.
- Findings carried into the guide:
  1. Delos application identifiers (4 GUIDs, PR 16682113) added for CloudSync on the same day the WIF 1P
     app ID remained commercial-with-one-TME-override. Two per-environment mechanisms now exist in
     source - XML `<Values>` and a C# `switch (DeploymentEnvironment)` - and neither is applied to WIF 1P.
     The sovereign finding is now "two mechanisms exist and both were skipped", which is stronger than
     revision 4's framing.
  2. Manager-plane RBAC is unconditional after `7de640de91` removed two flags. Management-plane
     authorization, not the SCIM target contract - recorded so a later run does not re-investigate it.
  3. `41c293cc` corrected profile PATCH merge semantics in five places. `profile.authentication` is
     replaced **wholesale**; `settings` and `serviceProviderConfig` are per-key merged; absent sections
     are preserved. Verified in `mergeProfilePartial`, not taken from the commit message.
  4. **New, not in the commit:** authentication-method add/remove emits **no** structured
     `emitAuthAdminEvent` - the controller persists `{ profile: { authentication } }` with no `settings`
     key, and the emitter is gated on `if (dto.profile?.settings)`. Credential CRUD (2 sites) and
     JWKS-host CRUD (4 sites) are covered; the highest-blast-radius action is not.
  5. **New, not in the commit:** lost-update race. Add/remove is read-modify-write over the whole block
     with no optimistic concurrency on `updateEndpoint`; the only ETag support found is SCIM *resource*
     `requireIfMatch`, one plane down.
  6. **New, not in the commit:** `// Deep-merge settings (additive)` survives above a shallow spread, in
     the same method whose docstring the commit corrected.
- Guide: **revision 6**, 5,987 lines, 303,742 bytes, on-disk SHA-256
  `F2BC7559D1A894E06E0E22E131B50D61831CA897305CCA6E08267B530028B6D3`.
  New sections 15.5, 15.6, 3.4.0.1-3.4.0.4, and 36; revision-5 content demoted to the `3.4.0r5` pattern.
- Validation: 22/22 Mermaid under the real `mermaid.parse()` **plus a passing negative control**; 25/25
  JSON; 220 fence markers balanced; 0 table column mismatches; 25/25 anchors resolve; level-2 sections
  1-36 all present; ASCII-only; 2 JWT-shaped strings decoded to `{"alg":"RS256","kid":"..."}` /
  `{"iss":"..."}` with 9-character signatures - confirmed placeholders.
- **Zero source-repository mutations.** SyncFabric stayed on `opentext` at `da0c7b46` with the same 3
  pre-existing modified files; all 5 SCIMServer worktrees unchanged. No branch switched, stashed, reset,
  or cleaned.
- Two self-inflicted defects, both caught and both generalised into the prompt:
  - an `edit` insertion anchored on `## 16. Connection information contract` consumed that heading;
    no existing check could see it, which produced the new section-inventory rule;
  - the table validator reported two false failures by splitting on Markdown-escaped `\|`, which
    produced the new validator-negative-control rule. The document was correct and the checker was wrong -
    the dangerous case, because "fixing" the document would have corrupted it.
- Deferred for a third consecutive run: no WIF token-mint latency measurement. Guide section 20.8 remains
  modelled, not measured.

### Run 7 - 2026-08-19

**Baselines.** SyncFabric `da0c7b46` -> `38c429b511f11ff07a787fb7b3ceb8e5358166b7` (112 commits, 774
paths). SCIMServer `21ca0a95` -> `e3ab7270e6d0c88eb02ca680c39ed3b03beaaec6` (36 commits, 102 paths,
v0.55.2 -> 0.55.6). Both prior snapshots verified as strict ancestors.

**The first double-sided runtime change in the series.** Runs 4-6 each found at least one side
invariant. This one found real authentication-behaviour changes on both.

- SyncFabric auth surface: 77 -> 77 files, membership identical, **2 blobs changed**, both from
  `09b2995e97` (PR 16713499, 2026-08-07): OAuth2 token-exchange URI validation flipped **fail-open to
  fail-closed**. `IsTokenExchangeUriAllowedCore` now returns `false` on missing/malformed cscfg where
  it previously returned `true`. Kill-switch `oAuth2TokenExchangeUriScim20FailClosedEnabled` is
  `Enabled=True` **globally, with no environment or slice qualifier**. When on, the legacy
  `oauthSettings.tokenExchangeAllowList` path is **unreachable**.
- Blast radius from source: prod has exactly three `OAuth2AuthorizationCodeGrant` connectors -
  `amazonbusiness` (URI configured, allowed), `contentstack` (**zero** cscfg settings), and `puzzel`
  (only `oAuth2ClientSecret`). Two of three would be denied. Three further connectors - `genetec`,
  `serviceNowScim`, `zoho` - ship `value=""` and are latent. Recorded as a source-derived risk with
  the telemetry signal that would confirm it, **not** as an incident.
- Also noted: the URI comparison is `Host | Scheme` only, so path/port/query are ignored. Fail-closed
  tightened the missing case, not the matching case.
- SCIMServer auth surface: 92 -> **93** (one added file), **7 changed**, from `85bd9aa4` (W1.5),
  `83f134de` (W1.4), `f2e9952f`. Two long-standing guide findings are now **fixed**: the JWKS
  maximum stale age (48 h ceiling) and the response caps/total deadline (1 MiB, 100 keys, 10 s).
- `login.windows.net` is now a **seeded** well-known JWKS host (Entra v1), with a committed RCA: it
  had been hand-added to the persisted layer on every long-lived estate with `label=null`, and a
  cross-tenant migration silently dropped it because count-based checks matched.

**The most consequential finding was about this workflow, not either codebase.** Revisions 2-6 of the
guide each re-raised `PERSIST_REQUEST_SECRETS` as a P0 that the operator had declined twice. Worse,
run 6 recorded the supersession *in this memory file* and still shipped a guide with 14 P0
references. Two rules follow: write declines into the **analysis artifact** (prompt 12.6.1), and
**sweep and count** after recording a supersession (gate 13). Run 7 swept the guide to zero live P0
claims; six mentions remain and every one explicitly labels itself withdrawn.

**A second self-correction:** revision 6 claimed the SCIMServer mirror of the guide was
"byte-identical" without hashing it. It was not - the two copies had diverged **bidirectionally**
(5,642 vs 5,987 lines), the mirror holding the operator's decision record and the canonical copy
holding all run-6 analysis. Resolved by absorbing the mirror's section 0.1 into the canonical file
rather than choosing a winner.

**Process failure repeated and caught:** an edit anchored on `#### 3.4.0r6 Revision 6 refresh`
consumed that heading, exactly the failure mode section 36 had documented one run earlier. Caught by
re-listing headings immediately after the edit. Rule upgraded: re-list after **every** structural
edit, not only at run end (prompt 12.6.3).

**Artifacts.**

- Guide **revision 7**: 6,455 lines, 335,885 bytes, SHA-256
  `860011BFA3DC5BC9C5973E94607B19C09090B0FB6B737C97EF88D119FF93FBDB` (Get-FileHash, on-disk CRLF
  bytes). New sections 0.1, 3.4.0 / 3.4.0.1-3.4.0.4, and 37; revision-6 content demoted to
  `3.4.0r6.x`.
- `files\RUN7_DELTA_BANK.md` written **early**, before analysis deepened, because runs 6 and 7 were
  both compacted mid-analysis. This worked and should be standard.
- Validation all green: **22/22** Mermaid under the real `mermaid.parse()` plus a passing negative
  control; **25/25** JSON; 224 fence markers balanced across 112 blocks; 0 table column mismatches;
  36 internal anchors resolve; level-2 sections **1-37** all present; ASCII-only; 2 JWT-shaped
  strings decoded and confirmed placeholders.
- `validate-guide-structure.js` section bound raised 36 -> 37, then **proved to fail** by demoting
  section 37 in a scratch copy. A gate that was not re-armed would have silently stopped checking the
  newest section.
- Prompt self-improved to **v1.6.0**: new section 12.6 with five standing rules, eight new
  anti-patterns, metadata and changelog updated.

**Zero source-repository mutations.** Both repositories were read through `git show`/`git diff`
against committed refs only; no branch was switched, stashed, reset, or cleaned.

### Run 7a - 2026-08-19 (post-publication correction)

Triggered by the user asking to list the remaining SCIMServer-side work. Answering it required
reading sections a keyword sweep had skipped, which exposed three defects **in revision 7 itself**.

- **A withdrawal is discharged only when the instruction is gone, not when the label is gone.** Run 7
  swept the guide for the string "P0" and declared A3 discharged. Section 31 item 1 still said "flip
  `PERSIST_REQUEST_SECRETS` to default off" and "rewrite `logging-redaction.spec.ts:80-87` - the
  test encodes the defect". Neither line contains "P0", and section 31 is titled *Recommended
  immediate next steps*, so the withdrawn instruction was sitting at **priority 1**. Sweep for
  imperatives and the identifier, never for the severity tag.
- **Never publish a total you did not compute from the rows.** The gap-matrix summary claimed two
  JWKS rows had moved to Done while both rows still read **Open** eleven lines above it, and the
  published totals matched neither. Recomputed from the body: 10 Done, 4 Partial, 11 Open, 1
  by-design.
- **"Carried forward by construction" is not verification.** The matrix header cited `e741c373`
  (2026-07-31) and justified the status column by the delta touching no runtime file. Every row is
  now re-checked by grepping its named symbol at `09b4b78d` (v0.55.7).

**Substantive re-verification:** A8 is far cheaper than revision 7 implied. `emitAuthAdminEvent`
already exists with its own spec and is already wired into `admin-credential.controller.ts`,
`admin-jwks-host.controller.ts`, and `endpoint.service.ts`; only
`admin-authentication-method.controller.ts` has zero emits. "Open - zero occurrences" was true but
read as a missing subsystem when it is a missing call site. Lesson: when reporting an absence, also
report whether the **mechanism** exists elsewhere - it changes the estimate by an order of magnitude.

**Also confirmed still open at `09b4b78d`** by direct grep: A4 (missing `client_id` accepted),
A5 (no replay denylist), A6 (no `azpacr` in trace), A7 (no `api://` audience validator), A9 (no
`ifMatch`/`rowVersion`), A10 (no `mergeStrategy`), A12 (comment still present), assertion byte
cap, mint-path total deadline, registry-vs-provider intersection, transport persona axis,
`typ=at+jwt`, RequestLog retention, and the credential index still `@@index([endpointId, active])`.

**SCIMServer moved during the session:** `e3ab7270` -> `09b4b78d` (3 commits: SCIM multiValued
sub-attribute validation, Playwright alignment, docs). No auth-surface change; ancestry verified.

Guide re-validated after the edits: structural ALL GREEN (224 markers / 112 blocks, 25/25 JSON, 37
anchors, sections 1-37, ASCII-only, 2 placeholder JWTs) and Mermaid **22/22** with a passing negative
control. New SHA-256: `4E47BF621481CDC75A7D79693471CCC5F863BEB424BF5C6915D57FBD4BD24B81`.
