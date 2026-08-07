---
description: Refresh and critically re-evaluate SyncFabric-to-SCIMServer authentication, WIF, 1P, IdP/ISV emulation, performance, environments, and implementation guidance from the latest sources, with persistent self-improvement.
mode: agent
---

# SyncFabric and SCIMServer Authentication Evolution

**Argument hint:** `--scope=delta|full`, `--auth=all|wif|1p|<method>`, `--syncfabric=<path>`, `--scimserver=<path>`, `--guide=<path>`, `--write=guide-only|repo-docs`

## Intent

Repeatedly re-establish the current authentication contract between:

- Microsoft Entra provisioning / SyncFabric as the client and token acquirer;
- customer Entra tenants and workload applications as identity issuers and subjects;
- target IdPs and ISVs as token services and resource servers;
- SCIMServer as a configurable test target that can emulate those target-side authentication contracts per endpoint.

The output is an evidence-backed update to the canonical architecture and implementation guide. The run must discover what changed since the prior analysis, re-test prior conclusions against current source, critically challenge the SCIMServer design, and improve this prompt and its memory for the next run.

This is a research, architecture, and documentation workflow by default. Do not implement product code unless the invocation explicitly requests implementation.

---

## Invocation

Use:

```text
/syncfabricScimserverAuthEvolution
/syncfabricScimserverAuthEvolution --scope=delta
/syncfabricScimserverAuthEvolution --scope=full --auth=all
/syncfabricScimserverAuthEvolution --auth=private_key_jwt
/syncfabricScimserverAuthEvolution --guide=C:\path\to\guide.md
```

### Availability

This workflow is `/`-invokable from two surfaces, which name it differently:

| Surface | Slash command | Registration |
|---|---|---|
| VS Code chat | `/syncfabricScimserverAuthEvolution` | This file, in `%APPDATA%\Code\User\prompts\`. The command name is the filename minus `.prompt.md`. |
| Copilot CLI | `/syncfabric-scimserver-auth-evolution` | `%USERPROFILE%\.copilot\skills\syncfabric-scimserver-auth-evolution\SKILL.md`, which only loads this file. |

**This file is the single source of behavior.** The CLI skill is a launcher and must never carry its own
copy of the phases, defaults, or guardrails; if it drifts, delete the duplication rather than
maintaining two definitions. Frontmatter here must stay limited to the VS Code prompt-file schema keys
(`description`, `mode`, and optionally `tools` / `model`) - CLI-style keys such as `name` and
`argument-hint` belong in the skill launcher, not here.

### Defaults

```text
syncfabricRepo = C:\one\AD-IAM-Services-SyncFabric
scimserverRepo = C:\Users\v-prasrane\source\repos\SCIMServer-master
syncfabricReference = origin/master
scimserverReference = origin/master
scope = delta
auth = all
write = guide-only
```

> **Worktree caution (verified 2026-07-31).** SCIMServer has multiple worktrees. `...\SCIMServer` is
> on a release branch (`release/0.55.0`), `...\SCIMServer-tls-policy` is on a feature branch, and only
> `...\SCIMServer-master` tracks `master`. Always resolve the worktree that actually has `master`
> checked out before reading source; do not assume the shortest path is the right one.

If `--guide` is absent, locate the newest existing file named:

```text
SCIMSERVER_SYNCFABRIC_WIF_ARCHITECTURE_AND_IMPLEMENTATION_GUIDE.md
```

under:

```text
C:\Users\v-prasrane\.copilot\session-state\*\files\
```

Update that file in place. Do not create a competing guide when a canonical guide exists.

Persistent prompt memory:

```text
C:\Users\v-prasrane\AppData\Roaming\Code\User\prompts\.memory\syncfabricScimserverAuthEvolution.memory.md
```

---

## Binding operating principles

1. **Latest source wins.** Current code and tests outrank commit descriptions, project docs, public product docs, and model memory.
2. **Delta first, full contract second.** Find what changed since the recorded snapshots, then revalidate every conclusion touched by those changes.
3. **No name-based conclusions.** A commit containing `WIF`, `1P`, `MSI`, or `FIC` can be irrelevant to the target wire contract. A commit without those strings can change the contract.
4. **Separate the identity axes.** Never conflate:
   - OAuth request `client_id`;
   - JWT `sub`;
   - JWT `oid`;
   - JWT `azp` or `appid`;
   - JWT `aud`;
   - Entra application/client ID;
   - Entra application object ID;
   - Entra service-principal object ID;
   - requested OAuth scope;
   - RFC 8693 `audience`;
   - connector `resource`;
   - SCIM endpoint ID;
   - issued access-token audience.
5. **Separate acquisition from target exchange.** Customer application, dedicated SyncFabric first-party application, managed identity, subidentity, and FIC describe how the source assertion is acquired. RFC 7523, RFC 8693, Basic, client secret, mTLS, and other methods describe the target-side exchange or resource authentication.
6. **Treat 1P as a first-class contract.** Analyze application IDs, service-principal provisioning, missing-SP recovery, scope composition, target-host normalization, compatibility overrides, feature flags, cloud-specific registration, telemetry, and tests.
7. **Be a critic, not a defender.** Identify incorrect abstractions, misleading names, inert fields, standards overclaims, unsafe defaults, scaling hazards, and unnecessary generalization.
8. **Measure or label estimates.** Performance numbers require a command, benchmark, source measurement, or explicit derivation. Never present invented round numbers as facts.
9. **External claims need current citations.** Fetch the authoritative RFC, Microsoft Learn page, vendor documentation, errata, or release note during the run.
10. **Real tokens are release gates.** Public examples cannot prove current SyncFabric claim shapes. Mark unobserved `aud`, `sub`, `oid`, `azp`/`appid`, `roles`, `ver`, and issuer behavior as empirical gates.
11. **Preserve dirty worktrees.** Never reset, clean, checkout, stash, amend, or revert user changes. Do not mix uncommitted files into a committed-source conclusion.
12. **No secret handling shortcuts.** Never print, persist, commit, upload, or send raw assertions, access tokens, client secrets, private keys, or authorization headers to third parties.
13. **Truthful metadata.** SCIMServer must advertise only runtime capabilities that are implemented and enabled for that endpoint.
14. **One canonical guide.** Reconcile and replace stale guidance instead of appending contradictory sections.
15. **Evidence classes are mandatory.** Mark material statements as Confirmed, Strong inference, Empirical gate, Proposal, or Superseded.

---

## Success criteria

A run is complete only when all applicable predicates pass:

- both remotes were fetched without changing the checked-out worktrees;
- exact source and comparison SHAs are recorded;
- every commit since the previous snapshots is classified as relevant, adjacent, unrelated, or superseded;
- current WIF/1P and selected auth wire contracts are reconstructed from request-building code and tests;
- current SCIMServer behavior is reconstructed from parser/controller, trust, validator, JWKS, issuance, guard, metadata, connection-info, admin, UI, persistence, and tests;
- the configurable endpoint-persona matrix covers every discovered target auth family and supported environment;
- architecture and performance findings cite files/symbols and measurements or state that measurement is pending;
- the canonical guide is updated in place with no stale source snapshot;
- all named source paths exist at the recorded revisions;
- JSON, PowerShell, TypeScript/pseudocode, HTTP examples, Markdown tables, and Mermaid diagrams are validated where tooling permits;
- source links resolve;
- no raw secrets or fabricated token values appear;
- the memory file is appended;
- this prompt's low-risk evolution checks are completed.

---

## Phase 0 - Load durable context

### 0.1 Read prompt memory

Read the persistent memory file before any source conclusion. If missing, create it from the seed at the end of this prompt.

Treat these memory sections as constraints:

- Heuristics That Worked;
- Anti-Patterns;
- Verified Cross-Repository Invariants;
- Open Empirical Gates;
- Source and Search Expansion;
- Run Log.

Memory is a lead, not authority. Revalidate any item touched by new source.

### 0.2 Read the current canonical guide

Extract:

- source snapshot SHAs;
- research date;
- latest relevant commits;
- known gaps;
- open empirical gates;
- decisions;
- file inventory;
- validation evidence.

Do not assume the guide's statements remain true.

### 0.3 Read repository-owned context

SyncFabric:

```text
memory-bank\README.md
memory-bank\coding-invariants.md
memory-bank\runprofile\00-quick-reference.md
memory-bank\runprofile\06-connectors\README.md
memory-bank\runprofile\06-connectors\configurable-connectors.md
memory-bank\infrastructure\utility-auth-secrets.md
memory-bank\infrastructure\feature-flags.md
memory-bank\infrastructure\netcore-syncfabric-core.md
memory-bank\manager\syncfabric-manager-graph-provisioning.md
memory-bank\testing\end-to-end\index.md
```

SCIMServer:

```text
.github\copilot-instructions.md
Session_starter.md
docs\CONTEXT_INSTRUCTIONS.md
docs\INDEX.md
docs\auth\
.github\prompts\
CHANGELOG.md
api\package.json
web\package.json
```

Load targeted files only. Do not dump entire indexes or repositories.

### 0.4 Knowledge graph

Check `.understand-anything\knowledge-graph.json` in each repository.

- If present and current enough, use it for changed-file nodes, one-hop dependencies, architectural layers, and complexity hotspots.
- If absent, explicitly report that `/understand` should be run in that repository for graph-backed analysis, then continue using Git and source.
- Do not treat an old graph commit as current. Compare its `project.gitCommitHash` to the analyzed revision.
- Under `--write=guide-only`, do not write graph overlays into either repository.

---

## Phase 1 - Establish immutable source baselines

### 1.1 Preserve worktree evidence

For each repository, record:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git remote -v
git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}'
```

Classify:

- committed source at selected revision;
- local uncommitted changes;
- untracked files;
- remote-only changes.

Exclude unrelated uncommitted changes from current behavior claims. If a relevant uncommitted change exists, report it separately as "working-tree candidate behavior."

### 1.2 Refresh remotes

Run:

```powershell
git fetch --all --prune
```

Do not merge, rebase, pull, checkout, or update the current branch.

### 1.3 Select references

SyncFabric:

- default to `origin/master`;
- also inspect the current branch if it contains auth changes not in master;
- record merge-base and ancestry.

SCIMServer:

- default to `origin/master`; `feat/wif` was merged into `master` and is now historical only;
- if a named feature branch is explicitly requested, compare it against `origin/master` rather than treating it as the baseline;
- resolve the worktree that actually has the target branch checked out (see the worktree caution under Defaults);
- compare local branch and upstream;
- record merge-base and ancestry.

### 1.3.1 Range completeness rule

**The analysed range must terminate at the reference you report.** In the 2026-07-31 run the delta
analysis covered `f8fa96f4..f1362f37` while `origin/master` had advanced to `6bd2ac8e`, leaving an
unanalysed tail. Re-resolve the reference SHA immediately before writing conclusions, and if it moved:

- analyse the tail range separately;
- state explicitly in the guide which range each conclusion covers;
- never report a head SHA you did not actually analyse.

### 1.3.2 Large-delta strategy

When either side exceeds ~50 commits since the previous snapshot, do not attempt a linear read.

1. Filter the range by auth vocabulary (Phase 2.1) to a candidate commit set.
2. Bucket candidates into *wire-contract*, *rollout/enablement*, *first-hop identity*, and *internal refactor*.
3. Analyse wire-contract commits in full; sample the rest for false negatives.
4. State the bucket counts in the guide so a reader can judge coverage.
5. Prefer delegating each side's classification to a separate bounded agent, but bank each result to a
   durable file the moment it returns - a completed analysis must survive an interrupted session.

### 1.3.3 Small-delta strategy: let the file list settle it

The mirror image of 1.3.2, added 2026-07-31 after a one-commit SyncFabric delta.

When a delta is small, compute the **union of changed paths first** and compare it against the
authentication surface before reading any diff hunk. If the two sets are disjoint, every file in the
surface is byte-identical to the previous snapshot **by construction**, and that is a stronger
statement than any blob-by-blob sample. Record it as a proof, not as an impression.

```powershell
git diff --stat <previousSnapshot>..<currentReference>
```

Rules:

- State the complete changed-path list in the guide when it is short enough to print. A reader can then
  re-derive the verdict without trusting the analysis.
- Still inspect any newly added configuration file for auth-relevant settings (authority, application
  ID, audience, scope, certificate, federation). A new file is not covered by "unchanged blobs".
- Do not use this shortcut to skip Phase 2 classification of the commits themselves; it establishes
  invariance of the *runtime surface*, not irrelevance of the *commit*.

### 1.3.4 Release branches and other non-`master` references

Added 2026-07-31, when the requested reference was `release/0.55.0` rather than `master`.

When the analysed reference is not the repository's mainline:

- record `merge-base`, commits ahead, and commits behind, and state whether mainline is a strict
  ancestor;
- if it is a strict ancestor, say so explicitly, because it lets every conclusion be reported as
  holding at both references;
- if it has diverged, analyse the divergence separately and never present a release-branch conclusion
  as a mainline conclusion;
- read the version from `package.json` on the analysed reference rather than assuming it matches the
  branch name. A branch called `release/0.55.0` can legitimately carry version `0.55.1`.

### 1.4 Determine previous snapshots

Read them from the guide and memory. Never hardcode the previous run's SHAs as permanent defaults.

Compute:

```text
previousSyncFabricSnapshot..currentSyncFabricReference
previousScimServerSnapshot..currentScimServerReference
```

If history was rewritten or the prior SHA is not an ancestor:

- compute merge-base;
- report the rewrite;
- compare both trees;
- do not silently substitute a range.

---

## Phase 2 - Discover and classify all authentication deltas

### 2.1 Commit search vocabulary

Search subjects, bodies, paths, symbols, configuration, and tests for:

```text
workload identity
workloadidentity
WIF
1P
first party
first-party
customer application
managed identity
MSI
FIC
federated identity credential
service principal
client assertion
private_key_jwt
jwt-bearer
token exchange
RFC 7523
RFC 8693
OAuth
client credentials
client secret
mTLS
DPoP
JWKS
issuer
audience
subject
authorized party
oid
azp
appid
resource
scope
token endpoint
authentication scheme
connection info
metadata
sovereign
ISV onboarding
```

Expand this vocabulary when new names appear. Persist useful additions to memory.

### 2.2 Classify each commit

Use:

| Class | Meaning |
|---|---|
| Contract-changing | Changes request fields, URLs, headers, claims, scopes, modes, target-token response assumptions, or resource authorization. |
| Acquisition-changing | Changes managed identity, subidentity, customer app, 1P app, service-principal provisioning, recovery, or token caching. |
| Configuration/rollout | Changes known secrets, connectivity schema, feature flags, cloud app IDs, allowlists, or deployment settings. |
| Reliability/telemetry | Changes retry, cache, key rotation, quarantine, metrics, logs, errors, or diagnostics. |
| Tests/docs only | Changes evidence or guidance without runtime effect. |
| Adjacent identity work | MSI/FIC/Graph/notification/onboarding changes that do not alter the target auth contract. |
| Superseded/reverted | A design later reverted or replaced. |
| Unrelated | No impact on this analysis. |

For every relevant commit record:

- full SHA;
- date;
- author;
- subject/PR;
- changed files;
- behavior before;
- behavior after;
- tests;
- rollout;
- whether current source still contains it.

Do not limit the analysis to one author. Highlight Ramsey Ali's sequence where relevant, but include all later authors and adjacent prerequisites.

### 2.3 Diff at file and symbol level

For relevant deltas:

- inspect the actual diff;
- trace definitions, callers, factories, config readers, tests, and feature flags;
- compare old and new request bodies;
- separate comments from executable behavior;
- identify deleted/reverted paths;
- verify current tree state after the commit sequence.

---

## Phase 3 - Reconstruct SyncFabric's current client contract

### 3.1 Acquisition modes

For every current mode, document:

- initiating workload;
- managed identity source;
- authority and tenant selection;
- token endpoint;
- client application;
- resource application;
- scope construction;
- assertion type;
- token cache key and lifetime;
- required configuration;
- fallback/recovery;
- telemetry and error stage;
- cloud/environment differences.

At minimum investigate:

1. customer-application chain;
2. dedicated SyncFabric 1P chain;
3. any new 1P variant;
4. any FIC/MSI path that feeds these chains;
5. mode compatibility and downgrade/override behavior.

### 3.2 1P deep checklist

Always inspect:

- production, TME/test, and sovereign first-party app IDs;
- app registration and Application ID URI assumptions;
- tenant service-principal provisioning trigger;
- Graph client identity and permission model;
- lookup/create conflict handling;
- missing-service-principal runtime repair;
- retry boundaries and cache invalidation;
- host normalization and aliases;
- `www.` handling, DNS casing, ports, paths, query, fragments, IDN, IPv4/IPv6 rejection or support;
- requested host-qualified scope;
- emitted token audience as an empirical gate;
- feature flags and rollout slices/environments;
- legacy customer-app override;
- requested/effective mode telemetry;
- tests for every connector strategy.

### 3.3 Target-side request profiles

Reconstruct exact encoded form fields from code for every target strategy:

- grant type;
- client authentication method;
- assertion/subject token field;
- token types;
- target `client_id`;
- target `audience`;
- target `resource`;
- target `scope`;
- requested token type;
- connector-specific supplemental fields;
- duplicate-key behavior;
- HTTP method, content type, URL composition, headers;
- response parser and required response fields.

Known families to revalidate, not assume:

- RFC 7523-shaped client authentication;
- RFC 8693 token exchange;
- SuccessFactors resource extension;
- Google federation plus service-account impersonation;
- Basic fallback;
- client-secret credentials;
- any newly added auth strategy.

### 3.4 Connector and environment matrix

Build:

| Connector/profile | Acquisition mode | Target auth profile | Required SyncFabric settings | Request additions | Response shape | Rollout |
|---|---|---|---|---|---|---|

Include configurable connector generations, SuccessFactors, Google Workspace, and every newly discovered consumer.

---

## Phase 4 - Reconstruct SCIMServer's current auth architecture

### 4.1 Inventory every authentication plane

Map:

- global/admin authentication;
- endpoint static bearer/API-key authentication;
- Basic authentication where present;
- OAuth client credentials with secret;
- WIF assertion exchange;
- token-exchange paths;
- issued access-token validation;
- endpoint/resource authorization;
- UI/admin setup and diagnostics;
- discovery and metadata;
- live-test and workflow support.

Do not assume the number or names of methods from docs. Derive them from routes, guards, providers, DTOs, persistence, and tests.

### 4.1.1 Registry breadth is not capability

Verified 2026-07-31: the SCIMServer admin registry accepts **ten** method types while only **four**
have a runtime provider, and SCIM discovery maps all ten to scheme names. Every run must:

- enumerate the declared method-type registry (`admin-authentication-method.controller.ts`);
- enumerate the actually-wired providers;
- report the intersection **and** the difference;
- flag any surface (metadata, discovery, connection info, UI) that publishes a registry type without
  a provider as a truthfulness defect, not a cosmetic one.

Never report "supports N methods" from a registry constant alone.

### 4.1.2 The canonical guide is an implementation contract

Verified 2026-07-31: SCIMServer source contains **22** citations of this workflow's guide section and
wave labels (`W2.2`, `W3.4`, `W3.7`, `guide 7.1`, "the SyncFabric guide Section 17"). The guide is no
longer an external proposal - the team implements from it. Therefore every run must:

1. grep SCIMServer source for guide citations and count them;
2. for each guide *proposal*, determine whether it shipped, partially shipped, or is untouched;
3. maintain an explicit **implementation status ledger** in the guide rather than leaving proposals
   ambiguous;
4. reconcile proposed file paths against where the code actually landed, and treat the shipped
   location as canonical;
5. never restate a shipped item as an outstanding recommendation - that destroys the guide's
   credibility as a work list.

### 4.1.3 Verify a delegated negative claim by mechanism, not by label

Added 2026-07-31 after two delegated exploration results were wrong in the same direction.

A sub-agent reported that the SCIMServer authentication-methods model was inert and that its JWKS
client failed closed. Both were false. The first failed because nothing in the codebase is named after
the design document: the model is consulted through a helper called `resolveEndpointAuthEnablement`,
so a search for a resolver named after "authentication method" finds nothing and concludes absence.

This is operating principle 3 - no name-based conclusions - reappearing inside a tool rather than
inside a person, and it is more dangerous there because the output reads as a completed search.

Therefore:

1. **Delegation is for breadth. Verification is not delegable.** Every load-bearing claim taken from a
   sub-agent must be re-read at the cited `path:line` before it enters the guide.
2. **Treat a delegated *negative* claim as unverified by default.** "X is not implemented", "nothing
   consults Y", and "there is no cap on Z" are the highest-risk outputs, because absence of a search
   hit is indistinguishable from absence of the feature.
3. **Search for the mechanism, not the label.** To test whether a persisted structure is inert, follow
   the *data path* (`profile?.authentication?.methods` reaching a decision), not the vocabulary.
4. **Record every correction in the guide.** A validation report that lists which delegated findings
   were wrong, and why, is worth more than one that only lists checks that passed.

### 4.2 Trace each method end to end

For each method:

```text
configuration input
-> persistence
-> public connection information
-> request parser
-> route ownership
-> credential/trust selection
-> cryptographic or secret validation
-> request-target authorization
-> token issuance
-> token response
-> resource guard
-> endpoint isolation
-> telemetry/diagnostics
-> tests
```

### 4.3 Mandatory file surfaces

Find current equivalents if paths moved:

```text
endpoint OAuth/token controller
WIF provider/trust selector
WIF assertion validator
external JWKS validator
JWKS host allowlist
OAuth service/token issuer
resource bearer guard
admin credential controller/DTOs
OAuth metadata controller
connection-info service/types
auth reason catalog
Prisma schema/repositories
Credentials UI
Connection panel/UI exports
unit/E2E/live tests
build and live workflows
auth architecture/docs
```

### 4.4 Persistence parity

If SCIMServer supports multiple persistence backends or deployment modes:

- verify every auth/trust operation in each backend;
- identify separate branches;
- require parity tests;
- identify cache invalidation differences;
- identify transaction/uniqueness differences.

### 4.5 Runtime truth table

Produce:

| Capability | Persisted | Parsed | Enforced | Advertised | Shown in UI | Tested unit | Tested E2E | Tested live |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

Any field that is persisted or displayed but not enforced is a design defect or must be explicitly labeled informational.

---

## Phase 5 - Model SCIMServer endpoint personas

The target is not "one universal auth toggle." The target is a small set of composable, standards-aware primitives plus validated endpoint presets that allow a SCIMServer endpoint to behave like a specific target IdP/ISV environment.

### 5.1 Separate dimensions

Analyze configuration along independent axes:

1. **Endpoint persona**
   - vendor/product;
   - environment/cloud;
   - protocol quirks;
   - metadata behavior;
   - error compatibility.
2. **Inbound token request profile**
   - Basic;
   - static bearer;
   - OAuth client credentials plus secret;
   - conventional RFC 7523 `private_key_jwt`;
   - SyncFabric RFC 7523-shaped application profile;
   - RFC 7523 JWT authorization grant if needed;
   - RFC 8693 token exchange;
   - mTLS;
   - any newly observed method.
3. **Issuer trust**
   - issuer;
   - JWKS/discovery;
   - tenant/cloud;
   - algorithms and key policy.
4. **Assertion identity binding**
   - audience;
   - subject;
   - object ID;
   - authorized party;
   - roles/scopes;
   - token version.
5. **Target request binding**
   - OAuth `client_id`;
   - `resource`;
   - RFC 8693 `audience`;
   - requested scopes;
   - token types;
   - account/service-user target.
6. **Issued token policy**
   - JWT or opaque;
   - audience;
   - subject/client mapping;
   - scopes/roles;
   - lifetime;
   - revocation/introspection;
   - sender constraint.
7. **Resource behavior**
   - bearer validation;
   - endpoint isolation;
   - SCIM route/auth quirks;
   - vendor-compatible errors.
8. **Operational behavior**
   - JWKS cache;
   - retry;
   - latency/failure injection for test personas;
   - telemetry;
   - rate limits.

### 5.2 Persona matrix

At minimum research and decide whether a preset is needed for:

- generic SyncFabric RFC 7523 target;
- generic SyncFabric RFC 8693 target;
- SyncFabric dedicated 1P commercial/TME target;
- SyncFabric customer-application target;
- SAP IAS / SuccessFactors;
- Google STS / Google Workspace first leg;
- conventional OAuth client secret;
- conventional `private_key_jwt`;
- Okta/Auth0/Ping-style token exchange where current clients require it;
- Zoom or other account/resource-parameter client credentials;
- static bearer/basic legacy target;
- sovereign Entra authority variants.

Do not claim support because a configuration can be imagined. Require parser, enforcement, metadata, UI, connection-info, and test evidence.

### 5.3 Preset versus engine decision

Compare:

1. hardcoded vendor handlers;
2. a fully generic policy language;
3. composable finite primitives plus versioned vendor presets;
4. do nothing.

Default preference:

- finite discriminated profiles;
- shared cryptographic verifier and token issuer;
- small target-policy objects;
- versioned preset templates;
- endpoint-level overrides only for validated differences.

Reject an expression DSL unless current source proves finite profiles cannot represent required behavior.

---

## Phase 6 - Standards and vendor research

### 6.1 Fetch current normative sources

Use authoritative current versions and errata for applicable standards:

```text
RFC 6749 - OAuth 2.0
RFC 6750 - Bearer Token Usage
RFC 7009 - Token Revocation
RFC 7517 - JWK
RFC 7519 - JWT
RFC 7521 - Assertion Framework
RFC 7523 - JWT Assertion Profile
RFC 7591 - Dynamic Client Registration, if proposed
RFC 7662 - Token Introspection
RFC 8414 - Authorization Server Metadata
RFC 8693 - Token Exchange
RFC 8705 - OAuth mTLS
RFC 9068 - JWT Access Token Profile
RFC 9449 - DPoP
RFC 9700 - OAuth Security BCP
OpenID Connect Discovery/Core where actually used
SCIM RFC 7643/7644 security and authentication declarations
```

Extract only relevant normative requirements. Distinguish MUST, SHOULD, MAY, implementation profile, and vendor extension.

### 6.2 Fetch current product sources

Prioritize:

- current SyncFabric source/tests;
- Microsoft Entra access-token claims;
- Microsoft Entra provisioning WIF guidance;
- AzureAD SCIMReferenceCode current WIF harness;
- SAP IAS / SuccessFactors workload identity guidance;
- Google STS and IAM Credentials;
- Okta/Auth0/Ping token exchange and private-key JWT docs where relevant;
- AWS web-identity STS only as a contrasting model;
- vendor-specific auth docs for every persona proposed.

Record page update dates or commit SHAs.

### 6.3 Standards profile precision

Explicitly answer:

- Is the inbound use a client-authentication assertion, authorization grant, or token exchange?
- Does conventional RFC 7523 require `sub == client_id` for this use?
- Does the SyncFabric integration deliberately differ?
- Is the issued token merely a JWT bearer or actually RFC 9068 conformant?
- Is metadata standard, extension, or misleading?
- Are errors and HTTP status codes standards-compatible and client-compatible?
- Does `/.default` belong to requested scope, token audience, or both in observed behavior?

---

## Phase 7 - Critical architecture review

### 7.1 Required lenses

For every major component, evaluate:

- purpose and cohesion;
- correctness and security;
- standards fidelity;
- type safety and invalid-state prevention;
- endpoint/tenant isolation;
- trust overlap and ambiguity;
- configuration lifecycle and migration;
- metadata truthfulness;
- UI/operator comprehensibility;
- testability;
- performance and scalability;
- availability and failure behavior;
- observability and privacy;
- cloud/environment portability;
- reversibility.

Use a severity/confidence/action table. Do not report style-only issues.

### 7.2 Critical-path performance model

Decompose token acquisition into stages:

```text
HTTP/form parse
-> endpoint lookup
-> credential/trust lookup
-> candidate filtering
-> unverified hint decode
-> JWKS cache lookup/fetch/refresh
-> cryptographic verification
-> claim checks
-> target request binding
-> issued-token signing or opaque-token persistence
-> decision trace/logging
-> response serialization
```

For each stage determine:

- time complexity;
- database query count;
- network round trips;
- cache key/cardinality;
- memory growth;
- concurrency behavior;
- single-flight behavior;
- retry amplification;
- timeout budget;
- high-cardinality telemetry risk;
- denial-of-service surface.

Mandatory questions:

- Is candidate trust selection O(number of active trusts)?
- Can one token trigger remote JWKS work for many trusts?
- Is unknown-`kid` refresh single-flight and bounded?
- Is there one total cancellable deadline across trust selection, redirects, retries, and backoff, or only per-fetch timeouts?
- Are issuer/JWKS caches partitioned safely by cloud/tenant/URI?
- Are assertion bytes, JWKS bytes/key count, active trust count, cache cardinality, and stale-if-error age hard-bounded?
- Can stale keys extend trust longer than intended?
- Are database trust reads cached and invalidated on CRUD?
- Is signing-key access synchronous or remote?
- Does decision tracing duplicate large objects or claims?
- Can an attacker cause high-cost crypto before cheap target checks?
- Are cheap checks safe before signature verification, or could they authorize?
- Does per-endpoint persona flexibility create unbounded branching?

### 7.3 Measurement discipline

Before recommending a performance design:

- search existing benchmarks and telemetry;
- run the smallest existing benchmark/test when safe;
- measure trust count, query count, cache behavior, and latency where possible;
- label modeled values as estimates with a formula;
- define p50/p95/p99 and throughput targets only from observed baselines or explicit product SLO decisions.

Never copy stale benchmark prompt numbers as current facts.

### 7.4 Threat model

Cover at least:

- forged assertion;
- wrong issuer/tenant/resource/principal;
- `client_id` substitution;
- RFC 8693 target escalation;
- resource confusion;
- cross-endpoint replay;
- downgrade/fallback;
- overlapping trusts;
- JWKS SSRF, redirect, DNS rebinding, oversized documents;
- key rotation and stale-key abuse;
- algorithm confusion;
- replay and retry compatibility;
- token response caching;
- raw token/claim leakage;
- route-level redaction before persistence even when a general troubleshooting flag permits ordinary request bodies;
- configuration privilege escalation;
- metadata deception;
- rate/CPU/memory exhaustion;
- sovereign-cloud authority confusion.

---

## Phase 8 - Environment and workflow architecture

### 8.1 Discover active environments from source

Do not copy a fixed environment list. Derive current active environments and clouds from:

- SyncFabric deployment configuration;
- first-party application configuration;
- feature flags;
- SCIMServer deployment docs and infra;
- current customer/ISV test plans.

Exclude deprecated environments unless explicitly analyzing legacy behavior.

### 8.2 Environment categories

Require a plan for:

1. local synthetic;
2. deterministic CI;
3. real Entra test application;
4. SyncFabric TME/customer-app;
5. SyncFabric TME/1P;
6. commercial production-like;
7. every active sovereign cloud;
8. ISV sandbox/staging;
9. customer preproduction and production;
10. negative/failure-injection environment.

### 8.3 Environment matrix

Produce:

| Environment | Entra cloud/authority | SyncFabric app/mode | SCIMServer host/persona | Trust data | Secret owner | Test workflow | Release gate |
|---|---|---|---|---|---|---|---|

For 1P, require a stable externally reachable host whose normalized DNS name matches the resource configuration.

### 8.4 Workflow coverage

Document:

- bootstrap;
- app/service-principal provisioning;
- trust creation;
- connection-info transfer;
- SyncFabric job configuration;
- first assertion observation;
- shadow validation;
- enforcement;
- provisioning smoke;
- key rotation;
- target client rotation;
- host migration;
- customer-to-1P transition;
- incident diagnosis;
- rollback;
- cleanup.

---

## Phase 9 - Design synthesis

### 9.1 Separate current, gap, and proposal

Every major section must distinguish:

```text
Current SyncFabric behavior
Current SCIMServer behavior
Compatibility gap
Proposed change
Migration
Verification
```

### 9.2 Required design artifacts

Include where applicable:

- context diagram;
- customer-app sequence;
- 1P sequence;
- each target auth profile sequence;
- internal token endpoint flow;
- trust-selection state/flow;
- data model;
- endpoint-persona model;
- environment/workflow diagram;
- performance critical path;
- request/response examples;
- decoded redacted token examples;
- configuration JSON;
- error mapping;
- capability metadata;
- connection-info examples;
- file-by-file plan;
- test matrix;
- rollout/rollback.

### 9.3 Decision log

For each architectural decision:

| ID | Decision | Alternatives | Evidence | Consequences | Revisit trigger |
|---|---|---|---|---|---|

Include a compact complexity budget and simplification delta.

---

## Phase 10 - Update the canonical guide

### 10.1 Update in place

Revise the guide rather than appending a second report.

**A guide must not contradict itself.** Added 2026-07-31: revision 3 corrected two conclusions in its
body ("advertises RFC 8693", "returns HTTP 201") while leaving both standing in its executive summary.
Operating principle 14 - one canonical guide, no appended contradictions - governs a document's
internal consistency, not only its relationship to older documents. Every run must therefore:

- grep the guide for each newly superseded claim and fix **every** occurrence, summary included;
- prefer deleting a disproved bullet over annotating it, and record the deletion with its evidence in
  a short note, so a reader of an older revision can see the requirement was met rather than dropped;
- treat a contradiction between a summary and a body as a defect of the same severity as a wrong fact.

**Filename suffixes are not recency.** When multiple copies of the guide exist, the header must carry a
revision number and an identity table for the sibling copies. A file cannot state its own hash, so
record authoritative hashes in the memory run log and reference them from the header.

Mandatory updates:

- source snapshots;
- research date;
- working-tree notes;
- "what changed since prior refresh" section;
- commit timeline and superseded designs;
- current wire contracts;
- current rollout;
- SCIMServer capability/gap matrix;
- endpoint persona matrix;
- architecture and performance analysis;
- environment matrix;
- implementation waves;
- acceptance criteria;
- source map.

Delete or rewrite statements invalidated by current source.

### 10.2 Documentation norms

- Clean Markdown.
- ASCII unless existing file requires Unicode.
- Valid Mermaid.
- Valid JSON without comments.
- Full HTTP examples with method, URL, headers, body, status, response headers, and response body.
- Use placeholders, never realistic secrets.
- State whether values are confirmed, observed, or illustrative.
- Cite source file and symbol or external URL.
- Use current Windows paths for local source references.
- Avoid duplicating long claim tables in multiple sections.

### 10.3 Write boundary

Under `--write=guide-only`:

- update only the canonical guide, this prompt's memory, and low-risk prompt metadata/changelog;
- do not modify either source repository.

Under `--write=repo-docs`:

- update repository docs only after confirming the intended target repository;
- follow its documentation, index, changelog, version, and session norms;
- do not implement runtime code unless explicitly requested.

---

## Phase 11 - Verification

### 11.1 Source verification

- previous SHAs exist;
- current SHAs exist;
- ancestry/rewrite status recorded;
- latest relevant commit search repeated after fetch;
- every referenced path exists at the recorded revision;
- relevant runtime files compared by blob SHA when an intervening commit is docs/UI only;
- feature flags and app IDs read from current source;
- current request bodies confirmed from builders and tests.

### 11.2 Artifact verification

Validate:

- balanced code fences;
- Markdown table column consistency;
- heading hierarchy and duplicate headings;
- sequential numbered sections;
- every JSON block parses;
- every PowerShell block parses;
- Mermaid blocks parse with an available renderer;
- URLs resolve with GET when HEAD is unsupported;
- no stale snapshot SHA remains in current-source headers;
- no unresolved `TODO`, `TBD`, or `FIXME` unless explicitly an open action;
- no raw tokens/secrets/private keys;
- no fabricated production domain or app ID presented as real;
- ASCII requirement;
- guide hash, line count, diagram count, and example count;
- **every backtick-quoted repository path resolves in one of the two repos, or is explicitly labelled
  as a proposed/not-yet-created file** - an unresolved path that is *not* labelled is a defect;
- **fenced code must not be nested inside a blockquote** when it needs to be machine-validated; put
  the prose in the blockquote and the fenced block immediately after it, otherwise the `> ` prefix
  makes JSON and PowerShell validation fail spuriously.

### 11.3 Repository verification

Record final status of both repositories and distinguish:

- pre-existing changes;
- concurrent changes;
- changes made by this run.

Do not claim "repositories untouched" without comparing starting and ending status.

---

## Phase 12 - Self-evaluation and controlled self-improvement

### 12.1 Score the run

| Dimension | Score 1-5 | Evidence | Required improvement if <= 3 |
|---|---:|---|---|
| Source freshness | | | |
| Delta completeness | | | |
| Current-contract correctness | | | |
| 1P depth | | | |
| SCIMServer architecture critique | | | |
| Persona/environment coverage | | | |
| Standards precision | | | |
| Performance evidence | | | |
| Security analysis | | | |
| Migration/reversibility | | | |
| Artifact validation | | | |
| Prompt/memory improvement | | | |

A score at or below 3 requires a concrete deferred action or another analysis loop before completion.

### 12.2 Senior-review gap pass

Ask:

- What changed that the original search vocabulary would have missed?
- Which conclusion still depends on a name rather than execution?
- Which auth profile is persisted/advertised but not enforced?
- Which persona cannot be represented without custom code?
- Which performance claim is unmeasured?
- Which environment lacks a real-token release gate?
- Which 1P claim remains guessed?
- What would break on key rotation, host migration, or overlapping trusts?
- What did the latest source add that the guide still underweights?
- What would a skeptical IdP/ISV security reviewer reject?

Fix gaps now where possible.

### 12.3 Update memory

Append:

- run date and source SHAs;
- scope and selected auth methods;
- changed commits and high-level findings;
- verified invariants;
- superseded conclusions;
- open empirical gates;
- successful search/validation techniques;
- failures and root causes;
- source/search vocabulary additions;
- artifact hash;
- self-evaluation scores.

Promote a lesson into the top memory sections only after:

- it has been observed in at least two runs; or
- it is directly proven by a normative source or executable contract.

### 12.4 Improve this prompt

Low-risk direct updates are allowed:

- execution metadata;
- changelog;
- newly verified source paths;
- new search vocabulary;
- new validation checks;
- new active auth profile names;
- corrected dead links.

Require user approval before changing:

- safety constraints;
- source hierarchy;
- evidence labels;
- write boundary;
- success criteria;
- promotion threshold;
- deleting an analysis phase.

Every prompt change must:

- cite the run finding that motivated it;
- avoid baking a temporary SHA or test count into a permanent rule;
- increment the prompt version;
- add a changelog entry;
- preserve prior useful checks unless evidence shows they are obsolete.

---

## Required guide outline

Preserve useful existing sections, but ensure the final guide covers:

1. Executive summary
2. Scope, non-goals, evidence hierarchy, confidence labels
3. What changed since the prior refresh
4. Complete SyncFabric auth/WIF/1P history
5. Current SyncFabric acquisition architecture
6. Current target-side wire contracts
7. Claim and identifier taxonomy
8. Current SCIMServer auth architecture
9. Current capability and enforcement truth table
10. Compatibility and security gaps
11. Endpoint persona and vendor/environment matrix
12. Target architecture and data model
13. Protocol handlers and routing
14. Issued token formats and resource authorization
15. Metadata, connection info, admin API, UI
16. Performance/scalability model and measurements
17. Security/threat model
18. Environments and operational workflows
19. Diagnostics, telemetry, and runbooks
20. Tests, CI, live validation, and empirical gates
21. Migration, rollout, rollback
22. File-by-file implementation waves and acceptance criteria
23. Decisions, complexity budget, simplification delta
24. Risks, open questions, immediate next steps
25. Source map and validation report

---

## Anti-patterns this prompt refuses

- Searching only commit subjects.
- Searching only for `WIF`.
- Treating every MSI/FIC change as an ISV contract change.
- Ignoring commits by authors other than the original feature author.
- Explaining a reverted design as current.
- Treating documentation metadata as runtime support.
- Calling a JWT "RFC 9068 compliant" without `typ`, required claims, and resource validation evidence.
- Calling SyncFabric's profile conventional `private_key_jwt` without addressing `sub` and `client_id`.
- Inferring token `aud` from a requested `/.default` scope.
- Treating JWT `sub`, `oid`, and `azp`/`appid` as interchangeable.
- Treating RFC 8693 `audience` as the incoming token `aud`.
- Making endpoint UUID the default Entra assertion audience.
- Advertising token exchange before runtime support.
- Adding a generalized policy language before finite profiles are exhausted.
- Adding vendor-specific cryptographic validators instead of one shared verifier.
- Measuring only a warm JWKS-cache happy path.
- Claiming multi-cloud support from hostname allowlist seeds alone.
- Using synthetic assertions as proof of SyncFabric claim shape.
- Updating the guide by appending contradictions.
- Modifying dirty source worktrees during a guide-only run.
- Persisting raw tokens in logs, files, CI artifacts, or prompt memory.

---

## Final response format

End with:

1. **Prompt** - path, version, memory path, and any self-edits.
2. **Sources refreshed** - old and new SHAs for both repositories.
3. **Material changes** - concise list of contract, 1P, architecture, performance, and environment findings.
4. **Guide updated** - path, line/diagram/example counts, hash.
5. **Validation** - passed checks and any blockers.
6. **Empirical gates** - unresolved real-token or environment validations.
7. **Repository state** - pre-existing/concurrent/run-created changes.
8. **Self-evaluation** - score summary and deferred work.
9. **Memory updated** - promoted lessons and prompt-evolution changes/proposals.

---

## Prompt metadata

```yaml
promptVersion: 1.3.0
created: 2026-07-23
lastExecution: 2026-07-31
executionCount: 3
canonicalMemory: .memory/syncfabricScimserverAuthEvolution.memory.md
lastSyncFabricSnapshot: c6f63afc37edde087bb6f8be9fbabb5929da736c
lastScimServerSnapshot: edcb330fd47ef69e8a96e2cbdf60fd7013677907
lastScimServerReference: release/0.55.0
lastGuideSha256: see the 2026-07-31 revision-4 run-log entry in the memory file
```

> **Standing requirement - self-improvement is mandatory, not optional.**
> Every execution of this prompt **must** end by updating this metadata block, appending a changelog
> entry, and appending a run entry to the memory file - even when the run finds no source change.
> A run that does not improve the prompt is an incomplete run. If a run genuinely produced no new
> lesson, record that explicitly as `no-new-lessons` in the changelog with the reason, rather than
> silently skipping the step.

## Prompt changelog

- 2026-07-23, v1.0.0: Initial cross-repository prompt. Added delta-first source refresh, complete 1P analysis, endpoint-persona modeling, standards and performance critique, multi-environment workflows, canonical guide updates, artifact verification, persistent memory, and controlled prompt evolution.
- 2026-07-23, v1.0.1: First-run improvement. Added mandatory total-deadline/cardinality checks for JWKS work and route-level pre-persistence redaction proof for bearer-credential paths.
- 2026-07-31, v1.2.0: Second-run improvement, driven by a ~86/~90 commit double-sided delta.
  - Corrected the SCIMServer defaults: `feat/wif` is merged, so the reference is now `origin/master`, and the repo path is the `SCIMServer-master` worktree.
  - Added a worktree-resolution caution after reading source from the wrong worktree was identified as a live risk.
  - Added section 1.3.1 **range completeness rule** after the run analysed `f8fa96f4..f1362f37` while master had advanced to `6bd2ac8e`, leaving an unanalysed tail.
  - Added section 1.3.2 **large-delta strategy** with auth-vocabulary filtering, four-way bucketing, and a requirement to bank delegated analysis results immediately so they survive interruption.
  - Added section 4.1.1 **registry breadth is not capability** after confirming ten registry method types against four real providers.
  - Added section 4.1.2 **the canonical guide is an implementation contract** after finding 22 guide citations in SCIMServer source; runs must now maintain an explicit implementation status ledger and reconcile proposed paths against shipped locations.
  - Added two artifact-verification rules: all backticked repo paths must resolve or be labelled proposed, and machine-validated fenced blocks must not be nested in blockquotes.
  - Recorded the last analysed snapshots and guide hash in metadata so the next run cannot silently reuse a stale baseline.
- 2026-07-31, v1.2.1: Availability and schema hardening.
  - Replaced the non-schema frontmatter keys `name` and `argument-hint` with the VS Code prompt-file schema keys `description` and `mode: agent`; the argument hint now lives in the body so it renders instead of warning.
  - Registered a Copilot CLI launcher skill at `~/.copilot/skills/syncfabric-scimserver-auth-evolution/SKILL.md` that loads this file rather than duplicating its rules, so the workflow is `/`-invokable on both surfaces from one source of truth.
  - Added the **Availability** subsection recording that surface-specific naming differs and that only this file may hold behavior.
- 2026-07-31, v1.3.0: Third-run improvement, driven by a deliberately small double-sided delta (1 SyncFabric commit, 9 SCIMServer commits) analysed against a **release branch** rather than mainline.
  - Added section 1.3.3 **small-delta strategy**. The mirror of the large-delta rule: compute the union of changed paths first, and when it is disjoint from the authentication surface, report invariance as a proof by construction rather than as a blob sample. Motivated by `6bd2ac8e..c6f63afc`, whose entire content was two Delos gateway configuration files.
  - Added section 1.3.4 **release branches and other non-mainline references**, after the run was asked to analyse `release/0.55.0`. Requires recording merge-base, ahead/behind, and strict-ancestry, and requires reading the version from `package.json` rather than inferring it from the branch name - the branch named `release/0.55.0` carried version `0.55.1`.
  - Added section 4.1.3 **verify a delegated negative claim by mechanism, not by label**, after two sub-agent findings were wrong in the same direction. The instructive one reported the authentication-methods model as inert because the consuming helper is named `resolveEndpointAuthEnablement` and does not contain the searched vocabulary. Delegated negatives are now unverified by default, and corrections must be published in the guide's validation report.
  - Extended section 10.1 with an **internal-consistency** requirement, after revision 3 of the guide corrected two claims in its body while leaving both standing in its executive summary. A summary that contradicts its own body is a defect of the same severity as a wrong fact.
  - Extended section 10.1 with a **filename suffixes are not recency** requirement plus a header identity table, after the highest-numbered copy of the guide turned out to be the oldest.
  - Recorded `lastScimServerReference` in metadata so a future run cannot mistake a release-branch snapshot for a mainline one.

---

## Memory seed

If the memory file does not exist, create:

```markdown
# SyncFabric and SCIMServer Authentication Evolution Memory

## Heuristics That Worked

(Promote only after two successful runs or direct normative/executable proof.)

## Anti-Patterns

(Promote repeated failures with root cause and prevention.)

## Verified Cross-Repository Invariants

(Current proven contracts with source revision and evidence.)

## Superseded Conclusions

(Prior statements invalidated by newer source.)

## Open Empirical Gates

(Real-token, environment, or performance questions still requiring evidence.)

## Source and Search Expansion

(New paths, symbols, authors, products, RFCs, and search terms discovered.)

## Prompt Evolution Proposals

(Changes requiring user approval.)

## Run Log

(Append oldest to newest. Include source SHAs, scope, findings, validation, scores, and artifact hash.)
```
