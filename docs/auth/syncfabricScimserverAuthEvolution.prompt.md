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

> **PowerShell hazard, added 2026-07-31.** `git diff $prev..origin/master` does **not** work in
> PowerShell. The parser reads `$prev..origin` as member access on `$prev`, so the expression expands
> to something like `..origin/master` and git returns a usage error rather than an empty diff -
> which is easy to misread as "no changes". Always build the range as a single string first:
>
> ```powershell
> $range = "$prev..origin/master"
> git -C $repo --no-pager diff --name-only $range
> ```

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

### 1.3.5 Prove invariance before reading diffs

Added 2026-07-31 after a run in which **both** repositories were runtime-invariant.

Sections 1.3.2 and 1.3.3 describe what to do once you know the delta's size. This section fixes the
*order*, because the order determines whether the verdict is a proof or a sample.

Work the tiers in sequence and stop at the first one that yields a proof:

| Tier | Action | Yields |
|---|---|---|
| 1 | Compute the **changed-path union** for the whole delta, before reading any diff content. Intersect it with the authentication surface. | If the intersection is empty: **invariance proved by construction.** Stop. |
| 2 | If the intersection is non-empty, compare **blob SHAs** for every file in the authentication surface - not only the files in the diff. | If all identical: **invariance proved at byte level.** Clear each apparent hit individually and stop. |
| 3 | Only now read diff content, and only for files that actually differ. | Full analysis. |

Two rules make this trustworthy:

1. **Define the authentication surface by pattern, then enumerate it at the current head.** Comparing
   only the files that appear in the diff proves nothing about files that do not; comparing every file
   matching the surface pattern proves something about all of them. A run that reports "78 of 78 auth
   blobs identical" has said something a diff listing cannot say.
2. **An apparent hit must be cleared by content, not by path.** When a configuration file that also
   holds authentication settings appears in the delta, filter its diff for the authentication
   vocabulary and report the result explicitly - for example, "the `features.ini` diff contains zero
   lines matching `workloadIdentity|firstParty|credentialLocation|clientCredentials|tokenExchange|oauth|assertion`."

### 1.3.6 A zero-change run is a result, not a failed run

Added 2026-07-31.

When the delta changes nothing, the finding **is** that the contract is stable, and that is what makes
it safe for the other repository to build against. Report it as the headline, not as an apology.

Then spend the recovered effort on evidence the delta was never going to supply. In descending order
of observed value:

1. **Committed proofs and captures** added since the last run - a real token capture closes empirical
   gates that no amount of source reading can.
2. **Unmerged branches**, by content (see 1.3.7).
3. **Documentation drift and mirror staleness** - stale vendored copies of this workflow's own
   artifacts are a recurring defect and are invisible in a runtime diff.
4. **Citation counts** against the canonical guide, which measure how far the guide has become an
   implementation contract (see 4.1.2).

### 1.3.7 Check unmerged branches by content, never by name

Added 2026-07-31 after branch names proved to be the least reliable signal in the repository.

In one run, two branches named `fix/profile-enforcement-gaps` and `fix/profile-enforcement-phase1`
were both **0 commits ahead** of mainline and carried nothing, while `feat/per-endpoint-tls-policy` -
a name containing no authentication vocabulary - carried a genuinely new architectural axis affecting
how every authentication method can be reached.

For every branch not merged into the analysed reference:

- record commits ahead and behind before reading anything;
- if 0 ahead, say so and stop - regardless of how relevant the name sounds;
- if ahead, classify by **changed paths**, and do not skip a branch because its name looks unrelated
  to authentication. Transport, proxy, and infrastructure branches can change the reachability of the
  authentication surface without touching a single authentication file.

### 1.3.8 Tier-2 comparison must detect deletions and renames

Added 2026-08-04, after finding that the invariance procedure could not have seen a removed file.

Enumerating the authentication surface at `HEAD` and comparing each file backwards to the previous
snapshot only ever inspects files that **still exist**. A file deleted or renamed between the two
snapshots never enters the enumeration, so it is silently reported as "unchanged" by omission. The
verdict is then a proof about the surviving files only, presented as a proof about the whole surface.

Every tier-2 comparison must therefore compare the two file lists as **sets**, not just the blobs of
the current list:

```powershell
$oldList = git -C $repo ls-tree -r --name-only $prev | Where-Object { $_ -match $surfaceRegex }
$newList = git -C $repo ls-tree -r --name-only $curr | Where-Object { $_ -match $surfaceRegex }
Compare-Object $oldList $newList   # '<=' is a deletion or rename-away, '=>' is a new or renamed-in file
```

Report deletions and additions explicitly, even when both are zero. "0 deleted" is evidence; a silent
absence is not.

### 1.3.9 A surface cardinality is a measurement, not remembered text

Added 2026-08-04, after a prior run's reported count was found to be wrong by one while its verdict
was correct.

Any number describing a repository - files on the authentication surface, commits in a delta, call
sites of a function, tests in a suite - is a **measurement of a moving target**. It must be re-derived
from source on every run and never copied forward from the previous revision's prose.

A carried-forward count is uniquely durable in the wrong way: nothing in the workflow forces it to be
re-checked, so it can survive many revisions while being wrong. Two consequences:

- when a run reports a count, it must have computed it in that run;
- when a run finds a previously published count to be wrong, it must correct **every occurrence**,
  say plainly that the earlier number was wrong, and state whether the conclusion that number
  supported is affected. Usually it is not - which is exactly why the error survives.

### 1.3.10 Resolve an author or keyword hint against the baseline before treating it as new

Added 2026-08-04, after a run was asked to look for a named author's workload-identity commits and
found that all of them predated the comparison baseline.

An instruction to "look at commits by X" or "look for changes to Y" identifies a **body of work**, not
a time window. The person giving the hint usually knows the work exists but not when it landed
relative to the last analysis.

Before reporting either presence or absence:

1. search the current delta for the hint;
2. if absent, search the **full history** and list what was found with dates;
3. compare those dates to the previous snapshot;
4. state the resolution explicitly - "this work is real, it is dated A to B, it is at or before the
   baseline, and it is already analysed in sections N and M."

"Already covered, here is where" is a complete and useful answer. Silently reporting "no changes
found" wastes the hint, and re-deriving already-analysed work wastes the run.

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

### 4.1.4 A new authentication family may move away from federation

Added 2026-07-31 after SyncFabric added AWS Identity Center discovery.

The workflow had drifted toward an implicit assumption that SyncFabric is migrating uniformly toward
federated credentials. It is not. It is federating **the SCIM target surface**. While the WIF programme
was in flight, a new connector family landed that authenticates with long-lived static IAM access keys
plus STS `AssumeRole`.

Therefore:

1. **Scope every directional claim to the surface it was proved on.** "SyncFabric is eliminating static
   secrets" is false as stated; "SyncFabric's SCIM target authentication is federated" is true.
2. **When a new family uses static credentials, check whether the platform offered a federated
   option.** AWS supports `AssumeRoleWithWebIdentity`, so a static key pair there is a design choice
   rather than a platform limit - and that distinction is the whole content of the recommendation.
3. **Classify the family even when the target repository need not emulate it.** A family that does not
   touch the SCIM contract still changes the shape of the taxonomy the guide presents, and presenting
   a taxonomy that implies uniformity is itself a defect.
4. **Look for identity attribution defects in any assume-role or impersonation path.** A fixed session
   or actor name collapses per-tenant attribution in the *customer's* audit log, which is the hardest
   class of problem for the customer to diagnose and the cheapest for the service to fix.

### 4.1.5 Credential-type enums get semantically overloaded

Added 2026-07-31.

`KnownSecretType` in SyncFabric now carries, for one connector family, an AWS access key ID in
`ClientIdentifier`, a secret access key in `ClientSecret`, an AWS **region** in `Server`, and an IAM
**role name** in `InstanceName`.

The consequence is specific and worth stating rather than generalising: any claim that credential
handling, redaction, rotation, or telemetry can be reasoned about generically **from the secret type**
must be re-tested per connector family, because the type no longer determines what the value is. When
a run makes such a claim, it must name the families it was verified against.

### 4.1.6 Beware name-based traps in the authentication vocabulary

Added 2026-08-04, after four newly added `ApplicationIdentifierDelos` constants surfaced in an
authentication keyword filter and were nearly classified as workload-identity changes.

Authentication vocabulary is not reserved vocabulary. In SyncFabric, "application identifier" denotes a
**ConnectedDirectory** identifier used by HybridSync and CloudSync - not an Entra application ID. A
filter tuned for `application`, `identity`, `principal`, `credential`, or `token` will surface these
and other homonyms.

Before classifying a keyword hit as authentication-relevant:

- read the declaring type and its namespace, not just the constant name;
- establish which **plane** it belongs to - SCIM target authentication, management-plane authorization,
  directory topology, or deployment configuration;
- if it belongs to a different plane, record it as cleared **with the reason**, so a later run does not
  re-investigate the same false positive.

The corollary is also true and was seen in the same run: a management-plane authorization change - the
removal of two RBAC feature flags making check-access unconditional - is genuinely security-relevant
and genuinely **not** part of the SCIM target contract. Adjacent is not the same as in-scope, in
either direction.

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

### 9.4 A gate must be able to fail

Added 2026-07-31, prompted by SCIMServer commit `d55faf97`, "fix(gates): live-test could never fail a
deployment".

A gate that cannot fail is worse than no gate. It produces the paperwork of assurance without the
assurance, and it actively suppresses the question it was created to keep open.

Every empirical gate, release gate, or acceptance criterion this workflow defines must therefore carry,
as part of its own definition:

- the **condition** it asserts;
- the **observation** that satisfies it;
- a **demonstration that it fails** when the condition is false - a negative test, an injected fault,
  or a recorded failing run.

When a run carries a gate forward without that third element, it must say so, because an untested gate
is an open question wearing a closed label.

### 9.4.1 A merge-semantics test needs a strict-subset input

Added 2026-08-04, as a specific corollary of 9.4, after SCIMServer commit `41c293cc` replaced a test
that could not detect the behaviour named in its own title.

The test was called *"should replace SPC when provided in partial profile"* and supplied **every**
key of the section under test. Under wholesale replacement and under per-key merge, a complete input
produces identical output - so the test passed regardless of which behaviour the source implemented.
It asserted nothing about merging while appearing to be the merge test.

Whenever this workflow evaluates or specifies a test over merge, patch, override, or replace
semantics:

- the partial input **must be a strict subset** of the current value, so that at least one key exists
  in the current state and not in the partial;
- the assertion must distinguish the two candidate behaviours by the fate of exactly those absent
  keys;
- the negative control must be **demonstrated** - flipping the source to the other behaviour turns the
  test red - not assumed.

Generalised: a test whose input makes two candidate behaviours indistinguishable is a gate that cannot
fail, and 9.4 applies to it in full.

### 9.5 Configuration-plane semantics are part of the authentication contract

Added 2026-08-04, after a refresh in which no token-path file changed on either side and yet the
authentication analysis changed materially.

An authentication runtime is only as safe as the configuration that reaches it. A run must not
conclude "authentication is unchanged" from runtime-blob invariance alone. Also examine, on the ISV
side:

- how a partial configuration update is merged, **per section**, and whether any auth-bearing section
  is replaced wholesale while a neighbouring section merges per key;
- whether concurrent configuration writes can lose an update - read-modify-write plus wholesale
  replacement plus no version guard is a silent lost-update race;
- whether every auth configuration mutation emits a **structured** audit event, and specifically
  whether the highest-blast-radius mutation is covered;
- whether the documented semantics match the implemented semantics in every place they are stated.

When runtime blobs are invariant but configuration semantics changed, state both plainly and do not
let the first finding imply the second.

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

**Filename suffixes are not recency - and neither is location.** Extended 2026-07-31 after a run
found the canonical session copy of the guide holding **revision 3** while **revision 4** existed only
inside a git worktree. Editing the file the run happened to find would have silently reverted a whole
revision of work.

Before the first edit of any run:

1. **Enumerate every copy** of the guide reachable from the session directory, the source repositories,
   and any worktree, and read the revision number from each header.
2. **If the copy at the canonical path is not the highest revision, do not edit it.** Verify the higher
   revision is a strict **superset** first - compare the level-2 section sets and confirm none was
   dropped - then promote it into the canonical path, preserving the older file under an explicitly
   superseded name.
3. **Record the promotion in the guide**, so a reader can see why the revision number jumped relative
   to the file they remember.
4. The header must carry a revision number and an identity table for every sibling copy, including its
   location and whether it is canonical, an authoring copy, a stale mirror, or superseded. A file
   cannot state its own hash, so record authoritative hashes in the memory run log and reference them
   from the header.

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
- Mermaid blocks parse with the **real** `mermaid.parse()` engine, not a regex linter - a regex linter
  has already passed a diagram the real parser rejected;
- URLs resolve with GET when HEAD is unsupported;
- no stale snapshot SHA remains in current-source headers;
- no unresolved `TODO`, `TBD`, or `FIXME` unless explicitly an open action;
- no raw tokens/secrets/private keys;
- no fabricated production domain or app ID presented as real;
- ASCII requirement;
- guide hash, line count, diagram count, and example count. **Hash the file BYTES on disk** (for example
  `Get-FileHash`). A validator that reads the file with universal-newline translation hashes a different
  byte sequence and yields a different, useless value - two hashes for one file defeats the purpose of
  recording one;
- **every backtick-quoted repository path resolves in one of the two repos, or is explicitly labelled
  as a proposed/not-yet-created file** - an unresolved path that is *not* labelled is a defect;
- **fenced code must not be nested inside a blockquote** when it needs to be machine-validated; put
  the prose in the blockquote and the fenced block immediately after it, otherwise the `> ` prefix
  makes JSON and PowerShell validation fail spuriously.

**A structural edit must be followed by a section-inventory comparison.** Added 2026-08-04, after an
insertion performed against a level-2 heading silently consumed that heading - the body survived, the
heading did not. No existing check could see it: fences stayed balanced, tables stayed well-formed,
ASCII stayed clean, and every anchor that still existed still resolved. Capture the ordered list of
level-2 headings before and after a structural edit and compare them; a missing or duplicated section
number is a failure.

**The validator must itself have a demonstrated negative control.** Added 2026-08-04, after the table
checker reported two false failures because it split rows on `|` without honouring the Markdown escape
`\|`. A checker whose failure mode has never been exercised is a gate that cannot be trusted to fail
correctly, and section 9.4 applies to it as much as to any release gate. Each validation run must
therefore:

- feed the checker a deliberately broken input and confirm it reports the failure;
- when a check fires, establish whether the **document** or the **checker** is wrong before editing
  the document - a false positive fixed by changing the document corrupts the artifact.

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
- **Re-raising a proposal the operator has declined.** Added v1.6.0 - see section 12.6.
- **Asserting two files are identical without hashing both in the same run.** Added v1.6.0.
- **Concluding "no runtime change" from an unchanged file set.** File-set membership and blob content
  are different questions; a fail-open to fail-closed flip changes neither the set nor any interface.
- **Reporting a feature flag as "gated" without reading its `features.ini` scope.** A flag section with
  a bare `Enabled=True` and no `appEnvironment:`/`slice:` qualifier is globally on, not staged.
- **Deriving blast radius from the flag alone.** Trace the value the flag's code path actually reads,
  to the configuration file that populates it, and enumerate which entities have it populated.
- **Re-deriving a measurement that may already exist in the other repository.** Search the counterpart
  repo's docs before declaring a gate unmeasured.

---

## 12.6 Standing rules earned by run 7

These are promoted to binding rules because each one cost a real error.

### 12.6.1 A declined proposal must be recorded in the analysis artifact

When an operator declines a recommendation, write the decision **into the guide**, at the point where
the analysis would otherwise re-derive it, with: the decision, its status, when and by whom it was
declined, the rationale, and what remains legitimately in scope.

The reason is mechanical. The analysis regenerates findings from source each run. If the source still
looks the way the proposal described, the proposal reappears - the decline lived somewhere the
regeneration never reads. Run 7 discovered that revisions 2 through 6 had each independently
re-raised `PERSIST_REQUEST_SECRETS`, which the operator had declined twice.

Corollary: a finding that has been considered and rejected must be recorded as **intended behaviour
verified**, never silently dropped. A later run cannot otherwise distinguish "nobody has noticed
this" from "this was decided".

### 12.6.2 Hunt explicitly for fail-open to fail-closed flips

Add this to the Phase 2 classification vocabulary as a first-class change class. Such a flip:

- adds no files, so a file-set comparison misses it;
- changes no interface, so a signature diff misses it;
- alters behaviour **only on the failure path**, so a green test suite is consistent with it;
- is frequently gated by a kill-switch whose default is the interesting part.

The only cheap detector is **blob comparison across the whole auth surface**, which this workflow
already performs - but the *verdict* must be phrased as "N files changed", never "the file set is
unchanged, therefore the runtime is unchanged".

When one is found, always establish four things: the flag name, its `features.ini` scope, the value
the new code path reads, and which configured entities have that value populated.

### 12.6.3 Re-list the heading inventory after every structural edit

Not only at the end of the run. An insertion anchored on a heading can consume that heading; run 6
lost `## 16.` this way and run 7 lost `#### 3.4.0r6` the same way. No fence, table, anchor, or JSON
check detects it, because the document remains syntactically valid.

### 12.6.4 A mirror is identical only if both copies were hashed this run

Never claim byte-identity from a memory of having synced, from a commit message, or from matching
line counts. Run 7 found the mirror and the canonical copy had diverged **in both directions** - each
held content the other lacked - while revision 6 asserted they were byte-identical.

When divergence is found, determine direction per-region rather than picking a winner: operator edits
in the mirror are authoritative and must be absorbed; analysis content in the canonical copy is
authoritative and must be preserved.

### 12.6.5 Check the counterpart repository before declaring a gate unmeasured

Run 7 found a committed WIF token-mint latency analysis in the SCIMServer repository while the guide
had been carrying that measurement as "deferred" for four consecutive runs. Before recording a gate
as open, search the other repository's `docs/` for it.

---

### 12.6.6 A withdrawal is discharged only when the instruction is gone

Removing a severity label is not the same as removing the instruction. After recording that a
proposal was declined, sweep the artifact for **what the reader is told to do** - imperatives
("flip", "rewrite", "must", "change the default"), the identifier itself, and the names of any files
the withdrawn action told the reader to modify. Never sweep for the severity tag. Revision 7 removed
every live "P0" and still shipped, at **priority 1** of its own "recommended immediate next steps",
an order to flip the declined default and to rewrite a test that is correct.

### 12.6.7 Never publish a total you did not compute from the rows

A count asserted in prose beside a table is unfalsifiable; a count derived from the table is a check.
Recompute every "N Done, M Open" summary from the table body immediately before publishing, and if
the two disagree, the body wins. Revision 7 published totals matching neither the body nor its own
narrative, while two rows contradicted the summary eleven lines below them.

### 12.6.8 "Carried forward by construction" is not verification

A status column may only be carried forward if the carry itself is verified this run. "The delta
touched no runtime file, so the column still holds" expires silently the moment the delta stops being
empty. Re-grep the named symbol for each row and cite the commit the check ran against.

### 12.6.9 When reporting an absence, report whether the mechanism exists

"Zero occurrences of X" is true but misleading if X already exists and is wired up elsewhere. State
whether the missing thing is a **subsystem** or a **call site** - the difference is an order of
magnitude in effort and changes how the receiving team prioritises. A8 was reported as "zero
emitAuthAdminEvent occurrences" when the emitter existed, had a spec, and was already wired into
three other files.

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
promptVersion: 1.6.1
created: 2026-07-23
lastExecution: 2026-08-19
executionCount: 6
canonicalMemory: .memory/syncfabricScimserverAuthEvolution.memory.md
lastSyncFabricSnapshot: 38c429b511f11ff07a787fb7b3ceb8e5358166b7
lastScimServerSnapshot: 09b4b78ddae1333503903f4a74968b3a9b228427
lastScimServerReference: master
lastScimServerVersion: 0.55.7
lastGuideRevision: 7 (corrected 7a)
lastGuideSha256: SEE_MEMORY_RUN_LOG
lastGuideSha256Note: SHA-256 of the file BYTES on disk (CRLF), per Get-FileHash. Do not record a hash computed over newline-translated text. The authoritative value for each revision lives in the memory run log.
lastSyncFabricAuthSurfaceCount: 77
lastScimServerAuthSurfaceCount: 93
authSurfaceCountNote: These are MEASUREMENTS at the snapshots above, recorded only so a later run can detect drift. Per section 1.3.9 they must be re-derived every run and never reported without recomputing.
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
- 2026-07-31, v1.4.0: Fourth-run improvement, driven by a **double-sided invariance run** (6 SyncFabric commits, 13 SCIMServer commits) in which neither authentication runtime changed.
  - Added section 1.3.5 **prove invariance before reading diffs**. Compute the changed-path union first, intersect it against the authentication surface, and stop at the first branch that yields a proof. SCIMServer terminated at "union contains zero runtime files"; SyncFabric needed the second tier and produced 78-of-78 identical blobs. This ordering makes the verdict a proof over the whole surface rather than a sample of whatever files were inspected, and it costs minutes.
  - Added section 1.3.6 **a zero-change run is a result, not a failed run**. Report invariance as the finding, and spend the recovered effort on evidence the delta did not supply - committed proofs, unmerged branches, documentation drift, and citation counts. This run's three most valuable findings all came from that recovered effort.
  - Added section 1.3.7 **check unmerged branches by content, never by name**. Two SCIMServer branches named `fix/profile-enforcement-*` were 0 commits ahead of mainline and carried nothing; a branch whose name mentions no authentication concept (`feat/per-endpoint-tls-policy`) carried a genuinely new architectural axis. Branch names are the least reliable signal in the repository.
  - Extended section 10.1 from "filename suffixes are not recency" to **location is not recency**, after the canonical session copy of the guide was found to be a full revision behind a copy living inside a git worktree. A run that edits the file it finds without comparing revisions will silently revert work. Comparison must be by content - confirm superset-ness of the section set - before promoting or overwriting.
  - Added section 4.1.4 **a new authentication family may move away from federation**. SyncFabric added AWS Identity Center discovery using long-lived static IAM keys plus STS `AssumeRole` while the WIF programme was in flight. Runs must not assume a monotonic migration toward federated credentials, and must scope claims to the surface actually federating.
  - Added section 4.1.5 **credential-type enums get semantically overloaded**. `KnownSecretType.ClientIdentifier` now carries an AWS access key ID and `Server` carries a region. Any claim that credential handling can be reasoned about generically from the secret *type* must be re-tested rather than inherited.
  - Added section 9.4 **a gate must be able to fail**, prompted by SCIMServer `d55faf97` ("live-test could never fail a deployment"). Every empirical gate this workflow defines must carry, in its own acceptance criteria, a demonstration that it fails when the condition is false.
  - Added a PowerShell hazard note to section 1.2: `$prev..origin/master` parses as property access and silently produces a `git diff` usage error. Assign the full range string to a variable first.
  - Recorded `lastGuideRevision` alongside the hash so the revision-identity check is mechanical.
- 2026-08-04, v1.5.0: Fifth-run improvement, driven by an **asymmetric run** - 23 SyncFabric commits with no authentication change, and only 6 SCIMServer commits, one of which changed how authentication configuration is merged. This is the first run where "the runtime did not change" and "authentication behaviour is unaffected" were not the same statement.
  - Added section 1.3.8 **tier-2 comparison must detect deletions and renames**. Enumerating the surface at `HEAD` and comparing backwards can only inspect files that still exist, so a deleted or renamed file is silently reported as unchanged by omission. Tier-2 now compares the two file lists as sets with `Compare-Object` and reports additions and deletions explicitly, even when both are zero.
  - Added section 1.3.9 **a surface cardinality is a measurement, not remembered text**, after v1.4.0's "78 of 78" was found to be 77 at every commit checked. The verdict was right and the count was wrong, which is exactly why it survived a revision: nothing forced it to be re-checked. Counts must be recomputed each run, and a correction must fix every occurrence and state whether the supported conclusion is affected.
  - Added section 1.3.10 **resolve an author or keyword hint against the baseline before treating it as new**. This run was asked to look for a named author's workload-identity commits; all of them predated the baseline and were already analysed. "Already covered, here is where" is a complete answer, and reaching it requires searching full history, not just the delta, when the delta comes up empty.
  - Added section 4.1.6 **beware name-based traps in the authentication vocabulary**, after four `ApplicationIdentifierDelos` constants surfaced in an auth keyword filter but turned out to be ConnectedDirectory identifiers for CloudSync. Classify by declaring type and plane, and record cleared false positives with their reason so a later run does not re-investigate them. The converse also applies: an unconditional-RBAC change is security-relevant and still out of scope for the SCIM target contract.
  - Added section 9.4.1 **a merge-semantics test needs a strict-subset input**, as a corollary of 9.4. A test named for replacement supplied every key of the section under test, so wholesale replace and per-key merge produced identical output and it passed either way. Merge tests require a strict-subset partial and a demonstrated negative control.
  - Added section 9.5 **configuration-plane semantics are part of the authentication contract**. Runtime-blob invariance does not license the conclusion that authentication is unchanged. Runs must examine per-section merge semantics, concurrent-write safety, structured audit coverage of the highest-blast-radius mutation, and doc-versus-implementation agreement.
  - Added an artifact-verification rule to section 11.2: **a structural edit must be followed by a section-inventory comparison.** An insertion performed against a level-2 heading silently consumed that heading; fences stayed balanced, tables stayed well-formed, and every surviving anchor still resolved, so nothing in the previous check set could catch it.
  - Added a validator-correctness rule to section 11.2: **the validator itself must have a demonstrated negative control**, after the table checker reported two false failures by splitting on Markdown-escaped `\|`. A checker that has never been shown to fail correctly is subject to 9.4 like any other gate.
  - Recorded the measured auth-surface cardinalities in metadata explicitly labelled as drift-detection measurements, not as reusable constants.
- 2026-08-19, v1.6.0: Sixth-run improvement, driven by the **first double-sided runtime change** in the series (SyncFabric 112 commits / 2 auth files changed; SCIMServer 36 commits / 7 auth files changed).
  - Added section 12.6, five standing rules, each earned by a real error in this run.
  - **12.6.1** - a declined proposal must be written into the *analysis* artifact, not only the implementing repository's plan. Run 7 found that revisions 2-6 had each independently re-raised `PERSIST_REQUEST_SECRETS`, which the operator declined at v0.54.63 and again on 2026-08-04. The analysis regenerates from source; a decline recorded elsewhere is invisible to it.
  - **12.6.2** - *fail-open to fail-closed flips* are now a named change class to hunt for. They add no files, change no interface, and alter behaviour only on the failure path, so file-set comparison, signature diffing, and a green test suite are all consistent with them. Four things must always be established: flag name, `features.ini` scope, the value the new path reads, and which entities have it populated.
  - **12.6.3** - re-list the heading inventory after *every* structural edit, not only at the end. Run 6 lost `## 16.`; run 7 lost `#### 3.4.0r6` the same way, in a run that had already added the end-of-run check.
  - **12.6.4** - a mirror is byte-identical only if both copies were hashed in the same run. Run 7 found bidirectional divergence while revision 6 asserted identity without checking.
  - **12.6.5** - search the counterpart repository's docs before recording an empirical gate as unmeasured. A WIF token-mint latency analysis existed in SCIMServer while the guide carried it as deferred for four runs.
  - Added eight anti-patterns matching the above, including "concluding no runtime change from an unchanged file set" and "reporting a feature flag as gated without reading its `features.ini` scope".
  - Updated metadata to the new snapshots, guide revision 7, and the re-derived SCIMServer surface count of 93 (up from 92 - a file was added, which is exactly the drift the labelled measurement exists to catch).

---

### v1.6.1 - 2026-08-19 (run 7a, same-day correction)

Triggered by a request to list remaining SCIMServer work, which surfaced three defects in revision 7
itself: a keyword sweep that left the withdrawn instruction at priority 1 of section 31, a gap-matrix
summary contradicting its own rows with totals matching neither, and a status column carried forward
"by construction" from a 19-day-old commit. Added rules 12.6.6-12.6.9. Guide gained section 37.9
recording the correction in the open.
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
