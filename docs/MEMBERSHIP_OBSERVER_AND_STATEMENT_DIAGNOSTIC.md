# Low-disturbance membership observation and statement diagnosis

**Last verified:** 2026-10-24
**Scope:** Unreleased local diagnostics, not release admission.

## DS-02: bounded complete-console capture and native causes (2026-10-24)

**Executive summary:** the source-only correction is implemented and the
single affected nine-file aggregate passes **84/84**, with zero failures,
cancellations or skips. No Docker, application, SQL, image inspection,
build, functional invocation, timing study or remote operation occurred.
The DS-01 study remains **INVALID after four BAAB visits**. Corrected source
is not a completed eight-round study, runtime qualification or admission.

### What is proven, and what remains unknown

The regression executes the **exact frozen DS-01 work-wrapper function**
from its retained source, substituting only a real bounded Node fixture for
the requested Docker executable. The fixture is configured to emit more
than 9 MiB on each native output pipe. Node actually reports
`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` under the frozen 8 MiB `execFile` limit.
Before the classifier correction, the assertion failed because the safe
category was `unexpected`; afterward it is `output-limit`, retaining that
finite native code. This proves a reproducible wrapper defect, **not the
historical DS-01 inner cause**. The old 8,394 ms failure did not retain its
native error or exact target. Neither is reconstructed.

Complete capture no longer depends on holding the full Docker console in
an `execFile` result. The explicit derived statement path uses one small
shared scanner for the PostgreSQL and application pipes:

```text
owned log subprocess: stdout + stderr
  -> fixed byte/record/deadline gates
  -> incremental canary scans + bounded record correlation
  -> both EOF events + successful native close
  -> live, immutable, non-text capture proof

any gate failure -> closed role-specific cause -> INVALID, never partial success
```

Both application roles and PostgreSQL have static identities:
`reference-app`, `candidate-app`, and `pg`. Complete framed records retain
their application/PostgreSQL origin. Unframed text, unfinished fragments
and cross-channel matches use the explicit `ambiguous-console` source;
the scanner never invents application-versus-Docker-tool attribution.
Its conservative tail combinations can reject an ambiguous reconstruction.
They cannot make an incomplete capture pass.

### Fixed limits, memory and unchanged deadlines

These constants are source-frozen and included in any future derived
manifest before allocation. They are not adjustable command-line settings.

| Boundary | Fixed maximum or requirement | Why it exists |
|---|---|---|
| One complete console capture, both pipes together | 64 MiB | Finite read/scan budget, not a 64 MiB allocated buffer |
| One newline-delimited record | 65,536 bytes | Bounds partial-record storage and JSON correlation work |
| One received chunk | 65,536 bytes | Rejects unexpected pipe-buffer growth rather than allocating an arbitrary chunk |
| Records in one capture | 1,000,000 | Bounds parsing work independently of bytes |
| Generated credentials | Eight roles, at most 256 UTF-8 bytes each | The five common roles include administrator; the other three are both application database users and the observer user |
| Scanner tails | Longest canary minus one byte | Detects chunk, normalized timestamp-frame and both channel-order boundary matches |
| Retained console frames | Two fixed 64 KiB buffers plus bounded tails | No complete console string, raw record or tail is exported |
| Other diagnostic tool text across the run | 8 MiB, incrementally checked | Bounds the existing in-memory metadata/tool input; it is not a raw Docker-log archive |
| Successful capture | Both pipes exist and reach EOF, close code zero, no signal, nonempty framed container text and no unfinished record | Empty, missing, truncated or unsuccessful input is never a complete proof |
| Current candidate correlation | Original categorized negative-request record must match the selected row | A generic error line or an unrelated request cannot substitute |
| Work / cleanup native maximum | Existing 60 seconds / 30 seconds, always clamped to the applicable absolute deadline | No deadline or reservation extension |
| Native-close allowance inside that maximum | 100 ms reserved inside, not added after, the command deadline | Bounds termination/closure handling within the existing maximum |

The 64 MiB limit is a prospective collection budget for this fixed workload,
not a claim that every possible logger output fits. For scale, it permits
roughly sixteen thousand 4 KiB records, while a block has 17,628 checked
workload requests distributed across the two apps. Logging is not assumed
to be one record per request. A larger actual output remains INVALID;
no automatic cap increase, tail dropping or replacement invocation exists.
The scanner's retained frame allocation is 128 KiB, not 64 MiB. Transient
chunk/string work is bounded by the chunk/frame limits; this is not a
claim about the entire Node process's resident memory.

The statement study still has a 45-minute absolute cap including its
90-second cleanup reservation. The separate functional harness still has
its unchanged 300-second cap and 120-second reservation. A 30-second
cleanup command maximum clamped to remaining absolute time is not an
extension of either outer cap. No functional harness or original admission
default was switched to this new diagnostic stream path.

### Privacy, native errors and proof identity

Selected rows are validated independently of console collection. Extracted
row-only checks do not pass dummy or empty consoles into old validators.
The original default validator keeps its exact result keys, correlation
predicate and privacy-first failure order; a new causal regression locks
that ordering. The derived path requires all eight actual generated
credential roles, independently masked rows, complete branded app/PG
captures and a nonempty checked tool input. Candidate correlation is bound
to the selected request identifier. A spread/serialized capture object, a
changed canary vector, a missing database role or a mismatched request
cannot replace the live proof.

Native metadata now has an allowlisted `nativeCode` as well as category,
numeric exit, known signal, duration, work/cleanup phase and static
operation/role/stage/command. Output-limit, native-buffer/memory/I/O,
spawn, abort, timeout, termination, unsuccessful exit and explicitly
unrecognized causes remain distinguishable. Unknown native strings become
`UNRECOGNIZED`, never an unchecked report field. Historical records without
the new optional field still validate.

The same safe taxonomy covers work Docker commands, complete log captures,
Git/PowerShell native failures, workload child failures and observer
startup/input errors, not only cleanup. Real Node children prove exit 7,
overflow and native `ENOENT`. A deliberately injected unknown native event
on a real owned child proves safe handling of private exception fields;
it is not claimed as an actual operating-system error code.
The first native cause survives a secondary privacy rejection.
Active minimal statement serialization retains exact reference/PG roles
and finite native codes without recycling private cleanup or error data.
Capture, removal, independent absence and network failures remain separate.

All eight roles are tested across genuinely separately acknowledged
one-character pipe chunks, timestamp-frame boundaries, both output pipes
and both cross-channel orders. There are no sleeps or Docker fallbacks.
Nonsecret output above 8 MiB on **each** pipe passes without retained
console text; over-total/over-record-frame, incomplete, empty, missing-pipe,
nonzero-exit, killed, hanging, wrong-correlation and forged-proof cases
reject for their intended causes.

### Execution issues and actual validation

Evidence directory: `test-results/ds02-stream-capture-20261023/`. Its name
records the task start date; the final source validation completed on
2026-10-24 UTC.

| Issue / detection | Confirmed mechanism and correction | Prevention / earliest possible detection |
|---|---|---|
| DS-02, observability / Medium | The frozen wrapper actually overflows on the synthetic fixture and formerly loses its finite native code. Streaming bounds memory independently of complete output and retains closed native identity. Historical DS-01 error remains unknown. | Exact frozen-wrapper and real pipe-volume tests before any long diagnostic |
| Missing database-role guard, test correctness / Medium | The first streamed-input implementation rejected a shortened canary vector only as a generic proof mismatch. The causal RED requires the closed `canaries-required` reason before proof validation. | Explicit eight-role guard and all-role row/tool/capture controls |
| Observer startup cause loss, observability / Medium | A real `ENOENT` child startup became only `Observer child startup failure`. Its native cause is now projected safely through the existing failure path. | Actual failed-spawn child and strict finite-code assertion |
| Extraction first-cause order, test correctness / Medium | The initial row extraction checked a malformed row before a console credential. A targeted RED caught this change introduced during implementation. The shared check now preserves the original console-privacy-first order. | Permanent default-validator ordering control; caught before the aggregate |
| Patch/lint friction, tooling / Low | Stale context hunks were refused, sometimes after explicitly reported partial application. Exact contexts were reread before applying remaining hunks. Scoped lint then caught the now-unused `fail` import; it was removed. | Final diff, ten-file syntax/lint and the aggregate prove the converged source; failed logs are retained |

The first three defects are detected in focused source-only controls, not
in a new runtime. The original complete-console defect escaped those
controls because they previously exercised small output. Detection-stage
escape is closed by adding a real bounded high-volume fixture, rather than
by claiming that the earlier functional pass covered workload-sized logs.

| Exact command / evidence | Actual result |
|---|---|
| `node --test --test-reporter=tap --test-name-pattern="exact frozen work wrapper" scripts\test\membership-console.test.cjs` (`red-frozen-wrapper.log`) | RED: one executed/failed, zero skipped; actual native MAXBUFFER assertion passed, safe category was incorrectly `unexpected` |
| Selector `streaming drains` (`red-streaming.log`) | RED: one executed/failed, zero skipped; new scanner absent |
| Selector `streamed statement inputs` (`red-streamed-inputs.log`) | RED: one executed/failed, zero skipped; missing closed all-role guard |
| Selector `observer native spawn` (`red-observer-native.log`) | RED: one executed/failed, zero skipped; actual native startup code discarded |
| Selector `original default console-privacy` (`red-default-order.log`, then `green-default-order.log`) | RED one/one; GREEN one/one, zero skips; original default first cause restored |
| Two-file focused streaming/derived integration (`green-console-integration.log`) | PASS 16/16, zero failures/skips, 8,975.1093 ms, before the last minimal-receipt/default-order controls were added |
| Final console-focused set (`green-console-final-focused.log`) | PASS 10/10, zero failures/skips, 8,704.2255 ms; final ordering control is covered by the subsequent one-test GREEN and aggregate |
| Single nine-file command below (`aggregate-serial.log`) | **PASS 84/84, zero failed/cancelled/skipped, 51,111.7441 ms** |
| `node test-results\ds02-stream-capture-20261023\validate.cjs static-final.json` | PASS: syntax and scoped ESLint for ten changed CJS files, zero findings |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` (`freshness-content.log`, final `freshness-final.log`) | PASS: 27 documents; content-only, not a full coupled deployment gate |

```powershell
node --test --test-concurrency=1 --test-reporter=tap `
  scripts\test\membership-lifecycle.test.cjs `
  scripts\test\membership-history.test.cjs `
  scripts\test\membership-privacy.test.cjs `
  scripts\test\membership-privacy-functional.test.cjs `
  scripts\test\membership-derived-functional.test.cjs `
  scripts\test\membership-observer.test.cjs `
  scripts\test\membership-statements.test.cjs `
  scripts\test\membership-derived-statements.test.cjs `
  scripts\test\membership-console.test.cjs
```

This includes all prior lifecycle controls and the four former aggregate
failures, plus current/legacy privacy, observer, derived proof, default
dispatch and exact diagnostic-admission rejection. The non-UTC 30-second/
35-second bounds and all existing runtime/cleanup assertions remain.
The old failed 62-test logs and the earlier 66/66 result are preserved;
this is not a rerun of an unchanged suite to obtain a favorable outcome.

The authoritative aggregate log SHA-256 is
`1b14c6b27d8119a5f99b589bcdaa9ee313390b95b4dfbe67fcb35b9d35e8c6f7`.
The closeout `preservation.json` records ten changed-source disk/staged-Git
hash pairs: all ten differ as raw CRLF/LF bytes, and all ten match after
newline normalization. It verifies 21 DS-01 evidence files, 23 frozen
inputs, four prior failed receipts, seven prior frozen inputs, six
unchanged admission/fixture files, both failed aggregate logs, the
corrected 66-test aggregate and the qualified functional receipt. The
prospective local runtime closure contains 24 files, including the new
scanner. All 90 local branches and ten stashes remain present.
`commit-closeout.json` binds the same bytes to the ordinary source commit
and checks that every other local branch and stash identity is unchanged.
Corrected current source is not relabeled as the source of any old
receipt. No Docker inventory was reread during this source-only task.

**Self-improvement: applied.** Real complete-output volume, explicit
EOF/native close, all-role boundary canaries and safe cause retention are
now executable guards. The recurring OS-17/DS-02 cause-loss lesson is
promoted into the central engineering patterns and standing instructions.
**Architecture: applied, with the existing orchestration size accepted.**
The concrete PG/application users share a small scanner and the old
validators share row predicates. The already-large statement runner
delegates scanning/validation; this correction does not introduce a
benchmark/lifecycle framework, dependencies or configuration knobs.

**Provenance limitation:** this entry is reconciled against all named
source-only RED/GREEN/static artifacts and exact frozen/current source,
including the failed lint output and context-patch recovery. It does not
claim to have reconstructed the unavailable historical native exception
or reconciled an unavailable full parent transcript. The parent's separate
read-only logging/index history evidence remains separate; no API history
research, index change or counterfactual SQL experiment was performed here.

**Remaining hold:** corrected streaming has not been exercised against a
new Docker study, nor is such an invocation authorized by this source-only
task. Any later invocation needs its own prospective identity, manifest
and source seal. The actual DS-01 partial SQL/WAL evidence remains
descriptive and INVALID, not causal. Baseline adoption, original-production
equivalence, release admission, publication and deployment remain held.

## DS-01: prospective DERIVED statement study (2026-10-23)

**Actual sole invocation: INVALID after four BAAB visits.** All eight visits
were required. ABBA was not started, and no replacement was attempted.
The first blocker was a complete-console Docker `logs` operation after the
first block's 66-outcome contract passed. All owned cleanup succeeded within
the unchanged cap. The partial SQL data suggests a logging-write concentration,
but it is not a completed study, privacy qualification or admission result.

Explicit
`--derived-statement-diagnostic-only` selects family
`membership-derived-statement-diagnostic`, not the existing original-image
statement family or release admission. Reference A is the functionally
qualified local image `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4`,
labelled **DERIVEDSTARTUPPRIVACYBACKPORT**, with original parent
`ghcr.io/pranems/scimserver@sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`.
Candidate B remains immutable 0.55.60
`ghcr.io/pranems/scimserver@sha256:316a645f021b5c9b833c295d94248e7df00ee37aa13d6d5614e55f9f04c83a4b`.
The parent authorized this reference only for this descriptive study;
there is no claim that the user explicitly adopted a changed release
baseline. Original negative 0.55.58 and four-round phase2/private failures
remain immutable and are not reinterpreted.

### Actual execution, first blocker and cleanup

Source was committed and clean at
`7b3ac1c74be54ec907e048254c00232ccc249794` before this sole command:

```powershell
node scripts\performance\run-membership-statements.cjs `
  --derived-statement-diagnostic-only `
  test-results\derived-statements-20261023\attempt1-20261023T233120820Z\run
```

The outer authorization intent was frozen before the safety preflight;
the runner's exclusive intent preceded Docker, and the full resolved
manifest and 23-file frozen closure preceded allocation. Preflight found
zero matching owned heavy processes, zero pre-existing study resources,
and the same three shared running containers. This is not a dedicated-host
or idle Windows/WSL scheduling claim.

| Check | Actual result |
|---|---|
| Start / finish UTC | `2026-10-23T23:32:18.891Z` / `2026-10-23T23:42:07.538Z` |
| Absolute cap / cleanup reservation | Unchanged 2,700,000 ms / 90,000 ms |
| Elapsed including cleanup | **588,647 ms**, command exit 1 |
| Schedule completed | BAAB only: B1, A2, A3, B4; 4/8 visits, zero ABBA visits |
| Original checked workload requests | **17,628**, four times 4,407 |
| Timing arrays | 16,000 measured operation samples plus 1,600 warmup operation samples; all four receipts and boundary arrays retained |
| Outside-window policy setup | Four additional HTTP PATCH requests and four independent administrator SQL policy reads, not included in 17,628 |
| Effective policy | Actual server false and stored endpoint false independently verified before every completed visit's windows |
| Actual identities/resources | Pinned A/B/PG platform IDs verified, all Linux/amd64; client Node v24.13.0; both apps 0.5 CPU/1 GiB, unchanged quota/period/burst/ancestor and RSS assertions |
| Other HTTP accounting | 16 readiness probes; the first current contract passed 66 outcomes. Contract/setup/flush requests remain outside workload accounting; no invented total contract HTTP count |
| SQL observer | Read-only default verified; app-role snapshots exclude observer-role work, preserve string query IDs and reset/eviction checks |
| First root failure record | Stage `contract-baab`, code `OWNED_DOCKER` |
| Retained safe action cause | Operation `command`, command `logs`, role `owned-container`, stage `docker-command`, phase `work`, category `unexpected`, duration **8,394 ms**, numeric exit code and signal both null |
| Complete private qualification | **NOT established**: no block role-privacy receipts were written; selected-row and complete app-console qualification did not finish |
| Final privacy checks | Final PG-console capture and accumulated tool-output checks completed without a reported canary rejection. These do not replace missing complete app-console/selected-row checks |
| Finalization | Four owned resources: metadata capture, removal and independent absence all passed; network removal/absence passed |
| Independent inventory | Zero owned containers/networks; exactly the same three shared full container IDs still running |
| Recovery or replacement | None needed; no second invocation, no cap extension |

The first contract file explicitly records `complete:true` and
`assertions:66`. The unchanged coarse stage name therefore must not be
read as evidence that the contract itself failed. The source next captures
the full PG console, then each role's selected rows and full app console.
The safe action receipt identifies a failed `logs` command in this interval,
but does **not** identify which of those captures or its native inner code.
Neither stderr nor a private console fragment was saved to reconstruct it.

**Established cause boundary:** a work-phase complete-console capture failed,
not the 45-minute cap or reserved cleanup. The source's work command limit
is 60 seconds; the failed operation lasted 8.394 seconds, and more than
33 minutes of work budget remained even at final completion. The tested
30-second cleanup maximum
remained clamped to the absolute deadline, and every finalization action
succeeded. It is a per-command maximum, not added time beyond the outer cap.

**Open inner cause:** the wrapper uses an 8 MiB `execFile` output buffer.
A complete console can exceed that buffer, and
`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` is not distinguished by the current
finite classifier. This is a source-proven risk and a plausible hypothesis,
**not a verified explanation of this historical error**. Transient native
errors also remain possible. The reused splitter is actually exported as a
function; a source-only load dismissed a missing-export hypothesis without
Docker dispatch. No privacy leak or application defect is inferred merely
from a failed console command.

### Partial BAAB SQL observations, not an eight-visit result

The following totals combine the two completed measured visits per role,
each with 1,000 complete four-operation cycles. A is the explicitly
privacy-derived reference, not actual production 0.55.20. Top-level and
nested statements are kept separate; they must not be added and called CPU.

| Measured top-level metric | DERIVED reference A | Immutable 0.55.60 B |
|---|---:|---:|
| Calls | 48,486 | 46,483 |
| Execution time, ms | 1,667.507 | 2,440.937 |
| Rows | 36,004 | 42,003 |
| Delta execution / delta calls, ms | 0.034392 | 0.052512 |
| WAL bytes | 27,855,524 | 45,346,701 |
| Logging INSERT calls / rows | 160 / 8,000 | 160 / 8,000 |
| Logging INSERT execution, ms | 610.069 | 1,043.575 |
| Logging INSERT mean, ms per completed call | 3.812929 | 6.522343 |
| Logging INSERT WAL bytes | 25,719,136 | 43,166,123 |
| Non-logging execution, ms | 1,057.438 | 1,397.362 |
| Separate nested calls / execution, ms | 4,000 / 33.378 | 4,000 / 27.260 |

Candidate top-level calls were **4.13% fewer**, while execution was
**46.38% greater** and the weighted per-call mean **52.69% greater**.
Logging INSERTs had the same 160 calls and 8,000 rows, but **71.06% greater**
execution. They account arithmetically for **56.05% of additional top-level
execution** and **99.75% of additional WAL bytes**. Their WAL share was
92.33% for A versus 95.19% for B. This supports prioritizing the logging
write family, but does not explain all execution change: non-logging
execution also increased, and the statement mix differs substantially.
This is not a uniform per-query slowdown: the SCIM-resource UPDATE family
was 168.444 ms for A versus 166.786 ms for B across the same 4,000 calls,
while the separate nested total decreased. A higher overall weighted mean
also reflects the changed mix of cheap and expensive statements.

The `references-resource-member` top-level family had 18,002 A calls versus
4,000 B calls; B additionally had 12,000 `mixed` calls and 8,001
endpoint-reference calls. Labels are query-text-reference classifications,
not exclusive application responsibilities. Distinct fingerprints cannot
be treated as the same query or execution plan.

| Visit | Role | Top-level calls | Execution, ms | WAL bytes | App CPU, seconds |
|---|---|---:|---:|---:|---:|
| BAAB 1 | B | 23,243 | 1,188.821 | 22,367,520 | 22.316 |
| BAAB 2 | A | 24,243 | 851.262 | 13,941,336 | 27.588 |
| BAAB 3 | A | 24,243 | 816.245 | 13,914,188 | 22.304 |
| BAAB 4 | B | 23,240 | 1,252.116 | 22,979,181 | 23.048 |

Leading logging fingerprints, without SQL text or parameters:

| Role | SHA-256 fingerprint | Calls | Execution, ms |
|---|---|---:|---:|
| A | `1287f7333f0724a1e2809945cf56ed79a714e71505672ffa23a92ed3631b6aad` | 160 | 610.069 |
| B | `871c0a0b86c9d6d40e9b322de5c9d5bae5705b6ab2fd94e5d444f554afd64176` | 160 | 1,043.575 |

Every per-fingerprint entry, operation/label, string query ID, call/row
delta, block/temp/WAL delta and weighted mean is retained in
`run/descriptive-analysis.json` and the original summaries. Shared-block
reads and temporary-block reads/writes were zero in these measured deltas;
shared hits, dirtied/written blocks, WAL records and full-page images remain
available rather than being silently omitted from raw evidence.

Application CPU was 49.892 seconds for A and 45.364 seconds for B, the
opposite direction from database execution. Throttled periods were
988/1,000 and 898/909 respectively. Pooled p99 request times in milliseconds
were A/B: add 88.453/84.294, populated read 69.054/62.880,
remove 79.504/83.267, empty read 66.967/63.497. These are retained-array
descriptions, not acceptance thresholds, causal attribution or evidence
that SQL execution equals request latency.

Sixteen warmup/measured boundary reads took 384.223 ms in aggregate,
18.390-32.849 ms each; their SQL-observer portions took 294.603 ms,
13.375-27.562 ms each. Measured-window observer execution deltas were
17.822 ms for A and 27.958 ms for B, excluded from app-role totals.
Sampling boundaries, buffered logging, query mix, app history and shared
Windows/WSL scheduling can affect these associations. The planned 200-row
selection is not a join from every request to every SQL event; it did not
produce a successful privacy receipt here. Missing ABBA and incomplete
privacy qualification prevent promoting these partial observations to
the requested complete diagnostic.

### Evidence, execution RCA and next bounded action

All evidence is under
`test-results/derived-statements-20261023/attempt1-20261023T233120820Z/`.
`sealed-evidence.json` verifies all 23 frozen files, six unchanged admission/
fixture files, four prior failed receipts, seven original frozen inputs,
the failed 62-test logs, corrected 66-test aggregate and qualified functional
receipt. All 23 new disk/Git raw hashes differ because of CRLF versus LF;
normalized source equality is verified, not falsely called raw equality.
The current statement runner intentionally differs from OS-17's old source;
the old executed inputs and receipts do not.

| Immutable new evidence | SHA-256 |
|---|---|
| Preallocation manifest and preregistered plan | `da57e6abda9c11815662e0ca93eb5e9a77920fb865374acb3ca66af74cfd7b82` |
| Actual runtime manifest | `ff49eaeefa769be68d57f844af64864bc8fe19097f1604bb60f45dcf85049302` |
| INVALID raw report | `346f5e3c3aca811901f674d5edc6c97ef0e4952131d51a68d3f473d5766d2abc` |
| Safe partial descriptive analysis | `989988e33fd484c5d0ed2400f73b7c4120f06cd547364e0eff7397b26c8d83b9` |

**Execution issue DS-02, tooling/observability, Medium:** complete-console
capture failed after real workload and contract execution. The actual
native cause was not retained beyond `unexpected`; no guessed inner code
is substituted. Detection was the first block's real console collection.
The earliest prevention opportunity was a bounded fake-CLI integration
test covering full-output limits, typed native failure classification and
the actual statement caller's role-specific capture path. Static wiring
and the small successful functional artifact qualification did not prove
large-workload console collection.

**Historical closeout disposition: scheduled at DS-01, now corrected in
source only by DS-02 above, not runtime-qualified.**
Owner: diagnostic harness maintainer. Target: 2026-10-24, in the next
source-only change and before any new runtime authorization. Add real bounded fake-CLI tests
for output-limit and native failures, preserve a closed native category
and exact static capture role, and choose a complete-output collection
strategy that keeps strict privacy scans, no raw private files and the
same absolute deadline. Do not truncate the console, enlarge time caps,
relax privacy, or rerun this study for a favorable result. The 8 MiB
hypothesis must be tested independently, not recorded as the actual cause.

Architecture disposition: **accepted** for this source chain. The explicit
opt-in reuses the existing runner, shared proof validator and lifecycle;
new identity/closure/privacy checks are cohesive and no generic lifecycle
framework was introduced. The next correction must stay on the concrete
capture boundary rather than spreading a new abstraction across admission.

Completeness provenance: this entry reconciles the exact committed/frozen
source, focused RED/GREEN and static logs, actual run/contract/round receipts,
closed action metadata and independent cleanup inventory. No full original
session transcript or destroyed historical raw error is claimed available.
The missing-export hypothesis was source-checked and dismissed.

The prior DERIVED functional qualification remains its own immutable,
narrow result. This study remains **INVALID**. Publication, release-baseline
adoption, admission and any new performance campaign remain on hold.
Post-run tracked changes are documentation-only. Content-only freshness
passed for 27 documents and `git diff --check` passed; this is not a
full coupled documentation gate. The unchanged focused suite was not rerun.

### Prospective contract and executable safeguards

- Shared existing build/source proof validation binds the exact app image;
  the sealed functional qualification is additionally pinned to SHA-256
  `cf6b36d17d0f754ae7c57d02d5fc0db801b074c8e80cb90005f0cf1e7d936210`.
  Missing, changed, unqualified or arbitrary proof is rejected.
- Exclusive intent precedes Docker. Full resolved manifest, source/Git
  newline identity and frozen input verification precede allocation.
  The input closure includes the entire performance runtime directory
  plus the external `minimal-group-members.ps1` used by the current
  66-outcome contract, not just the older selected helper list.
  A separate runtime manifest records actual fixture/app settings and
  loaded PostgreSQL client module hashes before workload windows.
- Exactly BAAB then ABBA, with the two apps reused within each block;
  equivalent new role databases per block. Each visit retains 100 warmup
  and 1,000 measured complete four-operation cycles, 4,407 checked workload
  requests and every timing/tail. No replacement or statistical acceptance.
- The 0.5 CPU, 1 GiB, 384 MiB RSS ceiling, 100 ms period, zero burst and
  ancestor policy are unchanged. The absolute cap is 45 minutes including
  the existing 90-second cleanup reservation. Derived cleanup native
  commands use the tested 30-second maximum, always clamped to remaining
  absolute budget; original statement dispatch/default identities remain.
- Server false is read back from the actual app environment; each visit
  explicitly patches endpoint false and independently reads stored policy
  through the fixture administrator before windows. The added HTTP PATCH
  and administrative SQL read are separately recorded, not in 4,407.
- One new owned cached PG17.11 fixture uses prospective
  `pg_stat_statements`, query IDs and track-all settings. The observer
  connection explicitly enables and verifies default read-only
  transactions. No shared statistics reset, installation, capability
  smoke, build proof rerun or functional qualification rerun is performed.
- SQL fingerprint hashing remains inside PostgreSQL. Query IDs remain
  strings; top/nested, calls/execution/rows/block/temp/WAL/reset/eviction
  evidence and excluded observer cost are retained. No SQL text,
  parameters, passwords or private console text is exported.
- Strict per-owned-database selected-row masks and all eight generated
  credential roles are checked against complete captured app/PG/tool
  console inputs, without the former 300-line tail. Final PG console and
  accumulated cleanup tool output are also scanned. Safe failure
  source/kind/row and lifecycle action metadata are retained.

### Source validation and RCA at correction

Evidence: `test-results/derived-statements-20261023/`.

| Command | Actual result |
|---|---|
| `node --test scripts\test\membership-derived-statements.test.cjs` before implementation | Corrected-interface RED: six executed, one default rejection passed, five failed because the derived implementation/wiring did not exist; `red-guards.log` |
| `node --test --test-reporter=tap --test-name-pattern="derived entry guard" scripts\test\membership-derived-statements.test.cjs` | RED: one executed/failed, zero skipped; explicit read-only observer setup was absent; `red-readonly.log` |
| Same one-test selector after adding complete-child-console guard | RED: one executed/failed, zero skipped; derived child still awaited exit rather than pipe closure; `red-complete-child-console.log` |
| `node --test --test-reporter=tap scripts\test\membership-derived-statements.test.cjs scripts\test\membership-statements.test.cjs scripts\test\membership-lifecycle.test.cjs` | Final execution-source GREEN: 28/28, zero failures/skips, 12,646.2587 ms; `green-execution-source.log` |
| `node test-results\derived-statements-20261023\validate.cjs static-ready.json` | Three syntax checks and existing seven-rule scoped ESLint passed, zero findings; `static-ready.json`, not full repository lint |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | Content-only PASS, 27 documents; `freshness-source-content.log`, not full coupled gate |

**Confirmed fixture gap:** the pre-existing observer had only read-statistics
privileges, but had not explicitly set session read-only transactions.
The earliest source review found it before runtime. A failing guard was
added first, then the derived branch sets and verifies the setting. The
original fixture/default remains unchanged. No historical observer write
or failure is inferred.

**Complete-console boundary:** a source guard failed before the derived
branch was changed to await the workload child's `close` acknowledgement,
not merely process `exit`. This ensures its stdout/stderr pipes have
closed before the in-memory output is scanned. Default dispatch remains
unchanged. Successful individual Docker action times are not newly
instrumented; failures retain the existing closed duration/cause metadata.

**Test/tool friction:** initial new tests used the wrong existing child
helper signature and admission role vocabulary; the intended-cause
assertion exposed the latter rather than accepting an unrelated throw.
The corrected RED log and subsequent GREEN are retained. The first scoped
validator omitted the Node `console` global; the next pass also caught a
throw introduced inside `finally`. Globals were corrected and the source
now emits closed safe failure metadata for nonprivacy report-write errors
instead of throwing from finalization. Earlier failed static logs remain.

**Self-improvement applied:** executable closure/missing-byte, exact proof,
read-only policy, eight-role/source privacy and intended admission-cause
guards. **Architecture disposition: accepted.** The existing runner is
already large; this narrowly opt-in extension reuses its execution path
and isolates proof/closure/privacy checks in a small cohesive helper.
It introduces no lifecycle framework or duplicate build-proof validator.
No speculative generic dispatcher was added.

## DF-13: one corrected-lifecycle DERIVED functional qualification (2026-10-23)

**Result: DERIVED_FUNCTIONAL_QUALIFIED, this immutable local artifact only.**
One newly authorized invocation completed in **199,619 ms**, with all privacy
and finalization checks passing inside the unchanged 300,000 ms cap. It
used committed source `4a5e67246abbb5b459133fc7825efee67af68321`, including
the OS-17 lifecycle correction and OS-18 tested child closure. No source
code changed, suite/smoke/build was rerun, or second invocation occurred.
The original attempt2 receipt remains INVALID. This observation does not
adopt a reference baseline, qualify actual production 0.55.20, establish a
performance result, or authorize publication/admission/deployment.

Evidence root:
`test-results/derived-functional-continuation-20261023/attempt3-20261023T230634807Z/`.
The exclusive authorization intent was frozen at
`2026-10-23T23:06:34.808Z`, before any Docker command. Ownership/shared
inventory followed; the runner then exclusively preregistered its own
intent before metadata inspection and validated the full resolved manifest
and seven frozen inputs before allocation.

| Check | Actual result |
|---|---|
| Run | `3e8ed8c290174d53bc2b361044284ce7`, started `2026-10-23T23:07:13.363Z`; absolute deadline `2026-10-23T23:12:13.363Z` |
| Immutable app | `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4`; actual container image equals requested image ID and pinned build/source proof |
| Original parent, unchanged | `ghcr.io/pranems/scimserver@sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`; no original or candidate app started |
| Fixture | One new owned PostgreSQL 17.11, pinned `postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`, and one DERIVED app |
| App settings | Actual CPU 500,000,000 NanoCPUs (0.5 CPU), memory 1,073,741,824 bytes; initial OOM false; reported product version remains 0.55.20 and is explicitly DERIVED |
| Requests | Seven authenticated requests; seven readiness probes, final health status 200; no measured cycles or replacement |
| Policies | Server environment independently read as `"false"`; stored endpoint profile independently read as `false` after explicit patch; preset initially omitted the override |
| Correlated Group rows | POST 201, PATCH 200, missing GET 404 and missing PATCH 404; four exact request-ID/endpoint/method/route/status matches, authorization present and exactly redacted |
| Credential absence | All five generated roles checked strictly: PostgreSQL administrator password, SCIM shared secret, JWT signing secret, OAuth client secret and credential encryption key |
| Complete private inputs | Selected rows, application console, PostgreSQL console and tool console separately collected/scanned; raw values stayed in memory; final accumulated tool output also scanned |
| Final captures | App PASS and PostgreSQL PASS, independently required; neither waived |
| Removal and absence | Both full-ID-owned resources removed and independently verified absent; owned network removed; final run-filtered container/network inventories empty |
| Failure metadata | `failures: []`, `actionFailures: []`; no failure category was discarded or substituted |
| Budget | 120,000 ms cleanup reservation unchanged; native maximum 30,000 ms always clamped to remaining absolute deadline; total 199,619 ms, no cap extension or out-of-cap recovery |

The seven authenticated statuses were: endpoint creation 201, endpoint
policy patch 200, the four Group statuses above, and flush 204. The strict
runner's original status is `DERIVED-FUNCTIONAL-PRIVACY-QUALIFIED`; the
separate sealed qualification receipt names the authorized result
`DERIVED_FUNCTIONAL_QUALIFIED` without rewriting that raw receipt.
Image labels and the original build receipt remain unchanged, including
their original pre-qualification `runtime-qualified: false` declaration.

### Exact execution, preservation and limitations

```powershell
node scripts\performance\run-membership-privacy-functional.cjs `
  --derived-reference-functional-only `
  test-results\derived-functional-continuation-20261023\attempt3-20261023T230634807Z\functional

node test-results\derived-functional-continuation-20261023\attempt3-20261023T230634807Z\seal.cjs
```

The sole functional command exited **0**. The independent seal exited **0**:
it verified all seven new frozen inputs/current source hashes, original
OS-17 source and admission/fixture files, four historical artifacts, seven
attempt2 frozen inputs, both old failed aggregate logs and the corrected
66/66 aggregate without rerunning them. All 90 branches and ten stashes
remain, with qualification branch still `d25b6155`. Disk CRLF and Git LF
hashes remain separately recorded; normalized equality is not raw equality.

| Immutable attempt3 evidence | SHA-256 |
|---|---|
| Authorization intent | `bb3f9131477dfb45da78da0817f411ccdf13b6e686495e18461154f5612ebf5a` |
| Runner intent | `3323ec9ed9889c4acdfcf5f576a79cd84c12c384b58e02aeec600618c3c61404` |
| Resolved manifest | `ef7e94745e0495689fbb7a9095daf7c3244d095152b44d150f915832bd2bccf5` |
| Original runner report | `569bdc66259f00ed8b404405c97630a3c6d5f074366b89608e84f3613a410866` |
| Sealed qualification receipt | `cf6b36d17d0f754ae7c57d02d5fc0db801b074c8e80cb90005f0cf1e7d936210` |

Post-run inventory independently found no owned containers/networks and
the same three shared full container IDs still running, prefixes
`6e679124468a`, `b9172b8deae2` and `f138ac5af4b3`. No mutation command
targeted them. Initial process-name/command-pattern screening reported
nonowned matches but no owned heavy worker; these matches are not proof
that every process was actually busy. This remains a shared Windows/WSL
host, not a dedicated-host performance observation.

Successful individual lifecycle action durations were not recorded by the
existing runner; only total elapsed and successful action flags are
available here. Safe failed-action durations/categories would have been
retained if an action failed. Do not infer a duration for each successful
capture/removal, reconstruct the old native error, or claim this run proves
which historical command exceeded ten seconds. Current strict outcomes
passed; the original inner error is still unknown.

**RCA/self-improvement disposition:** no new runtime failure occurred.
Existing safe-cause retention, mandatory independent final captures and
absence checks were exercised rather than weakened; no additional rule or
speculative timing instrumentation was introduced. **Architecture:
accepted**, no production or harness change was needed. This receipt closes
only local DERIVED functional qualification. Explicit baseline adoption,
publication, any statement/performance experiment, PR #251, push/CI/cloud
and deployment remain on hold. Documentation validation
`pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling`
passed for 27 documents (`freshness-content.log`), content-only, not a full
coupled gate. `git diff --check` passed. Earlier missing-path/tool-output
friction did not dispatch a workload;
no raw private output was saved. No full original transcript reconciliation
is claimed because the transcript pointer remains unavailable.

## OS-18: corrected child-boundary aggregate (2026-10-23)

**Applicable gate: PASS, 66 tests, zero failures, zero skips.** Exactly one
corrected seven-file serial aggregate was executed after the test-source
correction. The earlier 58/62 aggregate remains **FAILED**; its isolated
four passes were diagnosis, not a replacement gate. This is test-harness
qualification only. The DERIVED functional receipt remains INVALID and its
artifact remains unqualified. No new application, Docker command, image
inspection, SQL, build, timing campaign, remote operation or deployment ran.

### Observed failures versus proven source defects

The retained evidence is
`test-results/os17-source-finalization-20261023/green-serial-focused.log`.
Its filename does not mean it passed.

| Original failing child | Retained causal evidence | Source-proven test boundary |
|---|---|---|
| Missing counter fields/private extras | `Observer request timeout`, not the intended `Observer reply rejected`; 1,181.1741 ms | The 1,000 ms request timer started immediately after `spawn`, before Node/module startup or listener readiness was acknowledged. |
| Functional report-output fallback | Exit status `null`, expected `0`; 2,111.4927 ms | A 2,000 ms `spawnSync` timer included Node startup, importing the functional runner and its eager PG dependency, executing the serializer, and closing the child. |
| Minimal privacy fallback | Exit status `null`, expected `0`; 2,027.0918 ms | The same mixed startup/operation/close timer; no phase marker distinguished them. |
| Statement default-dispatch rejection | Exit status `null`, expected `1`; 2,096.2652 ms | The same mixed 2,000 ms timer; the old assertion did not require the actual opt-in failure cause. |

The observer stack proves the wrong failure category reached its assertion.
The three exit-status stacks are consistent with their configured total
timeout, but their original native `error`/`signal` and boot/readiness
timestamps were not retained. It is therefore **not possible to identify
their exact historical startup-versus-operation phase**. Neither current
startup measurements nor later isolated passes reconstruct that missing
evidence. No specific host-noise, shared-state, inherited test-discovery or
application defect is asserted.

The source also allowed observer teardown to send `kill` without awaiting
the child's `close` acknowledgement before the next fixture. That permits
overlap; the old evidence does not prove such overlap actually occurred.
Corrected teardown waits for closure. Clearing `NODE_TEST_CONTEXT` follows
the already-existing owned-child pattern and is asserted in each child
acknowledgement, not offered as a proven historical cause.

### Applied correction and causal controls

The change is confined to five test/fixture files. No production or
diagnostic workload implementation changed.
`scripts/test/membership-child-fixture.cjs` uses ordinary Node IPC:

```text
Fork one owned Node fixture
  -> BOOT acknowledgement
  -> load actual dependencies
  -> READY acknowledgement within bounded startup
  -> parent sends GO
  -> operation and normal child exit within original operation deadline
  -> await CLOSE acknowledgement before continuing
```

Startup has a separate 10,000 ms bound, matching the existing derived
preflight-child budget. This is not a blanket increase of operation timers.
Observer requests remain 1,000 ms, the intentional hanging-request control
remains 100 ms, raw-frame rejection remains 1,500 ms, both report serializers
and statement default rejection remain 2,000 ms, and functional/DERIVED
default guards remain 3,000 ms. For report/default fixtures, one operation
deadline covers **both** execution and normal process closure; closure does
not receive a second operation allowance. Exceptional fixture termination
has a bounded 1,000 ms close acknowledgement. The existing 4,096-byte report
output limit is preserved.

For real default-entry tests, dependency loading completes before READY.
The loader then executes the unchanged actual main entry, with the intended
arguments, and records only whether the **specific required assertion
failed**. An arbitrary exit `1` is insufficient. This does not claim a cold
CLI startup performance result. All subprocess APIs inside these test
fixtures are replaced with a closed, counted refusal; there is no Docker or
other external-command fallback. Test processes are not benchmark workers.

Three new cases supplement the existing 63:

- A structural RED requires readiness-aware fixtures in all three affected
  test families. It failed once before correction, with the missing
  startup-acknowledgement assertion.
- A real bounded fixture distinguishes `FIXTURE_STARTUP_TIMEOUT`,
  `FIXTURE_OPERATION_TIMEOUT` and `FIXTURE_EXTERNAL_DISPATCH`, verifies a
  successful exit, and proves that an unrelated exit `1` has zero intended
  guard hits. No sleeps or adaptive retry are used.
- A real, prepared-but-not-started observer deliberately receives a request
  before GO. It reproduces exactly `Observer request timeout`, demonstrating
  the old clock-placement failure without attributing it to host noise.
  The ordinary malformed-counter tests then require the intended
  `Observer reply rejected` after the listener acknowledges readiness.

Malformed reply tests now require their exact reply/stderr rejection cause,
not merely any exception without a private canary. All nine OS-17 lifecycle
controls remain in the aggregate, unchanged. No 30-second/35-second non-UTC
bound, five-minute functional cap, cleanup reservation, canary condition or
admission assertion changed.

### Actual corrected aggregate observations

These are fake-child test observations, not application/performance results.
The observer's final column is the GO-to-listener acknowledgement, **not**
the duration of the subsequent malformed protocol request.

| Child in the corrected aggregate | Boot ms | Ready after imports ms | Operation/normal-close ms |
|---|---:|---:|---:|
| Observer missing CPU counter | 66 | 74 | 2, listener acknowledgement only |
| Observer private extra field | 66 | 73 | 1, listener acknowledgement only |
| Report-output fallback | 63 | 150 | 12 |
| Minimal privacy fallback | 67 | 153 | 12 |
| Statement default guard | 74 | 159 | 14 |

These timings demonstrate the new boundaries on this run. They do not
establish how long startup took in the old failing aggregate or guarantee
that a future host always starts a child within the startup cap.

### Exact validation and gate table

All commands ran from the exclusive
`SCIMServer-gallery-mapping-20261014` worktree. Evidence is in
`test-results/os18-child-boundaries-20261023/`; no old log was overwritten.

| Command/evidence | Actual result |
|---|---|
| `node --test --test-reporter=tap --test-name-pattern='fixture clocks exclude' scripts\test\membership-observer.test.cjs` (`red-boundaries.log`) | RED: 1 executed, 1 failed, zero skipped; missing readiness boundary |
| Three-file targeted boundary selection (`focused-boundaries.log`) | GREEN: 7 executed, 7 passed, zero skipped |
| Four-file targeted causal/default selection (`focused-causal-controls.log`) | GREEN: 5 executed, 5 passed, zero skipped |
| `node test-results\os18-child-boundaries-20261023\validate.cjs` (`static.json`) | Five changed CJS files pass syntax and the existing seven-rule scoped ESLint check, zero findings; not full repository lint |
| Corrected seven-file command below (`aggregate-serial.log`) | **PASS: 66 executed, 66 passed, zero failed/cancelled/skipped; 26,012.7132 ms** |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` (`freshness-content.log`) | PASS, 27 documents; content-only, not the full coupled gate |

```powershell
node --test --test-concurrency=1 --test-reporter=tap `
  scripts\test\membership-lifecycle.test.cjs `
  scripts\test\membership-history.test.cjs `
  scripts\test\membership-privacy.test.cjs `
  scripts\test\membership-privacy-functional.test.cjs `
  scripts\test\membership-derived-functional.test.cjs `
  scripts\test\membership-observer.test.cjs `
  scripts\test\membership-statements.test.cjs
```

The two targeted commands, including their exact selectors and file lists,
are retained in the source-only validation command record. There was no
unchanged aggregate retry and no serial-only production-fix claim: serial
execution is the explicitly requested aggregate selector, while the
correction is fixture readiness, cause checking and lifecycle closure.

### RCA, cap interpretation and remaining holds

**Type/severity:** test correctness and lifecycle observability / Medium.
**Symptom:** an applicable aggregate failed while isolated tests passed.
**Root mechanism:** operation assertions used clocks that also charged
unacknowledged process/import startup, and insufficient lifecycle/cause
evidence made unrelated timeout/exit failures indistinguishable from their
intended negative controls. The exact old native inner phase is unknown.
**Fix:** acknowledged startup and operation boundaries, original operation
deadlines, specific failing guard/reply assertions, external-dispatch
refusal and awaited child closure.
**Why it works:** a slow or broken setup now fails explicitly as setup;
it cannot consume the malformed-protocol/serializer/default-guard budget
before that operation is allowed to start. Exit status alone cannot satisfy
the default guard. Each owned fixture has completed closure before reuse.
**Detection/escape:** the original aggregate caught this; the earliest
possible gate was an executable pre-readiness/causal-negative fixture
control, now added in-place. Isolated passes never close a failed aggregate.

The OS-17 cleanup maximum remains 30,000 ms, **clamped to the remaining
absolute outer deadline**. It replaces a shorter per-command limit, not the
five-minute wall cap: each call receives `min(30000, deadline - now)`;
nonpositive remaining time rejects before dispatch. It does not promise
twelve full 30-second allowances or extend the 120-second reservation.
Both final captures, successful removals, independent absence evidence and
the original 300,000 ms total limit remain mandatory. The destroyed actual
legacy cleanup exception is still unknown.

**Architecture disposition: accepted.** A small test-only IPC fixture is
shared by observer, privacy and default-entry tests; no production seam,
dependency, pool, framework, product version, protocol or configuration knob
was introduced. Splitting this cohesive fixture further is speculative.
**Self-improvement: applied.** Readiness/operation/close acknowledgement and
intended-cause negative controls now execute in the applicable aggregate.
No additional functional invocation is authorized by this result. Baseline
adoption, publication, performance qualification, PR #251, CI/cloud and
deployment holds remain unchanged.

### Committed identity and preserved evidence

The coherent test correction, gate result and RCA are committed as
`c306c1e2ec1713f6a2b6821b980be8703028fa12`. Source-only preservation command:

```powershell
node test-results\os18-child-boundaries-20261023\preserve.cjs
```

It passed. Its exclusive `preservation.json` has SHA-256
`5a18a7a3c71d0b99b8f51abff8808d3a401d951c57b9188b9239c7258ab820b2`.
It records the five tested file hashes separately for disk CRLF and Git LF;
all five match after newline normalization and none is claimed raw-equal.
The corrected aggregate log has SHA-256
`78e7042a5b9779f9a17ec1098dcbe4f0c8f3a2338910bcc5f69f1f2aae5ae72b`.

The preservation check also passed for all seven OS-17 tested source inputs
(including the unchanged lifecycle spec), six admission/fixture/proof
files, seven original frozen inputs and four immutable historical
intent/manifest/receipt/recovery artifacts. Local qualification still points
to `d25b6155bace7af2ec4ccb89f2eb0048e2db0c26`; 90 branches and ten stashes
remain. No history rewriting or remote operation occurred.

| Retained old FAILED aggregate | SHA-256 |
|---|---|
| `green-focused.log`, 55/62, seven failures | `08fb80b1eaebb49e9ac5b8717b27181a33bc0d857e7a3138faad1e6f9d760455` |
| `green-serial-focused.log`, 58/62, four failures | `7eeeca22ef03a0fce08331d54b783171c07af06d33077081d3acd13b7a38b57c` |

**Provenance/completeness:** this RCA reconciles the four retained causal
stacks, inspected test/fixture source, structural RED, two focused GREEN
selections, the sole corrected aggregate, static/freshness output and the
current source-only command history. One log-extraction PowerShell command
had a quoting parser error before execution; stdin script input corrected
that tooling friction. No validation or workload ran from the rejected
command. `VSCODE_TARGET_SESSION_LOG` is unavailable, so no full original
transcript reconciliation or recovery of destroyed inner errors is claimed.
The final documentation check is recorded separately as
`freshness-closeout-content.log`, using the same `-SkipCoupling` content-only
command, not a full coupled freshness gate.

## OS-17 / DF-12 source-only correction (2026-10-23)

**Result: implemented and locally tested, not runtime-qualified.** The
executed functional runner did not inherit its work deadline or an aborted
HTTP signal into cleanup. It did impose a shorter native-command timeout
on cleanup, and both its wrapper and shared finalizer destroyed the native
failure category. The corrected source retains closed, safe action causes
and uses the existing 30-second functional command maximum within the
unchanged absolute five-minute deadline. No Docker process, container,
application, SQL probe, build, remote operation or performance experiment
was dispatched during this correction.

The original attempt2 receipt is still **INVALID**, the DERIVED artifact is
still unqualified, and adoption of a different reference is not approved.
This source correction does not repair or reconstruct old private evidence.

### Executed flow and limits of the historical evidence

The inspected source is the retained seven-file snapshot from executed
`e0d884b97bf74d629da717d4678c96a6240fcdd5`, not a substitution of current
helpers into an old run.

| Boundary | Retained or derived time | What it proves |
|---|---|---|
| Start | `2026-10-23T21:57:42.131Z` | Retained receipt timestamp |
| Work cutoff | `2026-10-23T22:00:42.131Z` | Source: start + 300 seconds minus 120 seconds reserved cleanup |
| Original report | Start + 228,079 ms | Retained elapsed time; app final capture and both removals failed before the outer deadline |
| Absolute deadline | `2026-10-23T22:02:42.131Z` | Retained receipt deadline; not extended |
| Independent safety recovery | Start + 350,556 ms | Separate recovery exceeded the original cap and cannot qualify the receipt |
| Individual original cleanup calls | Not retained | No original command duration, native code, signal or cleanup-entry timestamp can be reconstructed |

The actual control flow was:

```text
Work failure or completion
  -> close owned PG client
  -> app: inspect/capture -> inspect ownership -> remove -> query absence
  -> PG:  inspect/capture -> inspect ownership -> remove -> query absence
  -> inspect network ownership -> remove network
  -> query remaining owned containers -> query remaining owned networks
  -> strict tool-console canary scan
  -> enforce final evidence and absolute elapsed cap -> write receipt
```

Each Docker call in this functional finalizer used `cleanup=true`.
That branch selected `deadline`, not `workDeadline`, and did not call the
work guard. The HTTP `AbortSignal.timeout(...)` instances were local to
their individual fetch calls; none was supplied to Docker execution.
There is consequently **no source proof of an inherited work-deadline or
abort-state bug in this executed runner**.

There are twelve CLI invocations on the healthy two-container cleanup path:
four per container, two for the network, and two final inventories. At the
old ten-second per-call maximum, their sum alone could consume the entire
120-second reservation, before client close or JavaScript overhead.
This is a source-level budget-headroom limitation, not a measurement of
which historical command failed or proof that round-trip count caused it.
The separate recovery's 10.926-second metadata read is consistent with a
too-short command limit, but is not the swallowed original error.
No speculative batching was introduced: all fresh ownership reads and
independent absence queries remain. Any later round-trip optimization needs
its own evidence and ownership analysis.

### What changed, and what did not

| Concern | Corrected behavior |
|---|---|
| Functional native timeout | Both work and cleanup use the existing 30,000 ms command maximum, clamped to the correct remaining deadline. Work still stops at the original 180-second work boundary; cleanup never inherits that boundary. |
| Absolute limits | Shared timeout computation rejects an exhausted budget before native dispatch. History, statement and observer-smoke cleanup commands are now also clamped to their existing absolute deadlines rather than receiving an independent unbounded sequence of per-call allowances. Their configured command maxima are otherwise unchanged. |
| Native evidence | Wrappers retain only a validated operation, role, stage, category, budget phase, finite exit code, allowlisted signal, duration when available, and static command category. A killed child is reported as `terminated`, not guessed to be a timeout. |
| Actual budget phase | Projection preserves a validated underlying budget phase. A cleanup caller cannot relabel an underlying `work` deadline rejection as `cleanup`. |
| Action continuation | Capture, remove and absence verification are independently attempted for every known owned resource. Ordered `actionFailures` retain the first lifecycle cause; each resource row also retains its action failures. |
| Absence versus capture | False absence is explicitly `still-present`. Verified absence is not successful capture or removal, and any failed lifecycle action invalidates diagnostic completion. |
| Ownership | Full returned IDs and owner/run labels are checked; a known allocated full ID must match. Functional removal uses the freshly verified full ID, not a reusable name. Network removal likewise uses its verified full ID. |
| Network versus container | Network inspection, removal, absence and container inventory retain distinct static operations instead of being only generic booleans. |
| Privacy fallback | Closed lifecycle failures survive minimal receipt projection in order. Extra/private fields are never copied. Invalid action metadata produces a static `invalid-metadata` cause instead of recursively rejecting the privacy receipt. |
| Unavailable facts | Unknown durations are `null`, not fabricated zero-duration measurements. No raw message, stderr, arguments, connection string, arbitrary nested cause, credential hash, length or surrounding private context is retained. |

The shared finalizer's `verified` field continues to mean absence only.
The callers explicitly require capture and removal too; its meaning has
not been silently widened to claim complete final evidence.
The same safe-cause wiring is present in all four active local diagnostic
runners, including the observer smoke runner. Its prior 32-read evidence
was not rerun or reinterpreted.

The benchmark request path, SQL, fixture, client configuration, image pins,
sample counts, quantiles, resources, CPU policy, admission runner and
production versions are unchanged. No new framework, dependency, command-line
configuration flag or automatic replacement attempt was added. Any future
diagnostic must freeze the new source bytes; old frozen receipts describe
only their original source.

### Executable evidence and exact validation

Evidence is retained under
`test-results/os17-source-finalization-20261023/`.

| Check | Actual result |
|---|---|
| `node --test --test-reporter=tap scripts\test\membership-lifecycle.test.cjs` before implementation | RED: 7 executed, 7 failed. The real failing capture/hanging-removal path reproduced boolean-only information loss. `red.log` |
| Same initial seven cases after implementation | GREEN: 7 executed, 7 passed, zero skips. `green-initial.log` |
| `$env:OS17_FROZEN_RED='1'; node --test --test-reporter=tap --test-name-pattern='actual functional cleanup wrapper' scripts\test\membership-lifecycle.test.cjs` | RED: exactly 1 executed, 1 failed, zero skips. The exact frozen Docker-wrapper body ran against a real 11-second Node metadata fixture and failed at its old ten-second native timeout. `red-frozen-wrapper.log` |
| Current-wrapper version of that same real-child test | GREEN in focused coverage: slow metadata completed inside remaining cleanup time. A separate real failing native child retained network-removal exit 9; its synthetic private stderr still triggered strict tool-console canary rejection. |
| `node --test --test-reporter=tap --test-name-pattern='actual failing budget phase' scripts\test\membership-lifecycle.test.cjs` before phase-projection correction | RED: exactly 1 executed, 1 failed, zero skips. `red-phase-projection.log` |
| Seven-file focused regression, default test concurrency | 55/62 passed; seven bounded-child assertions failed. Retained as `green-focused.log`, despite its filename. Not a green gate. |
| Same seven files with `--test-concurrency=1` | 58/62 passed; four existing child timeout assertions failed. All eight then-existing new lifecycle cases passed. `green-serial-focused.log` is not a wholly green run. |
| Four failed existing cases isolated with unchanged source and time limits | 4 executed, 4 passed, zero skips. `focused-failure-triage.log`. This is a classified rerun of distinct failures, not an assertion that a clean 62-case run occurred. |
| Final phase/projection selector, command below | GREEN: exactly 3 executed, 3 passed, zero skips. `green-phase-and-projection.log`. Nine unique new lifecycle cases are covered across the focused runs; no full-suite rerun was added for this one-line projection correction. |
| Seven changed CJS files | Syntax and the existing seven-rule scoped ESLint harness passed, zero findings. Full configured ESLint was not restored or claimed. |
| `node test-results\os17-source-finalization-20261023\validate.cjs static-final.json` | Seven syntax checks and seven-rule scoped lint passed with zero findings. |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | PASS for 27 docs. This is a **content-only** check, not the full coupled freshness gate. |

The seven-file command was:

```powershell
node --test --test-concurrency=1 --test-reporter=tap `
  scripts\test\membership-lifecycle.test.cjs `
  scripts\test\membership-history.test.cjs `
  scripts\test\membership-privacy.test.cjs `
  scripts\test\membership-privacy-functional.test.cjs `
  scripts\test\membership-derived-functional.test.cjs `
  scripts\test\membership-observer.test.cjs `
  scripts\test\membership-statements.test.cjs
```

The isolated existing-failure command was:

```powershell
node --test --test-concurrency=1 --test-reporter=tap `
  --test-name-pattern='missing counter fields|functional report-output|^minimal privacy receipt|new family is rejected' `
  scripts\test\membership-observer.test.cjs `
  scripts\test\membership-privacy-functional.test.cjs `
  scripts\test\membership-statements.test.cjs
```

The final phase/projection command was:

```powershell
node --test --test-reporter=tap `
  --test-name-pattern='closed lifecycle|actual failing budget phase|privacy fallback' `
  scripts\test\membership-lifecycle.test.cjs
```

The new controls cover real slow, hanging and failing subprocesses, cleanup
after work exhaustion, successful cleanup while budget remains, refusal
after absolute expiry, nonowned/full-ID mismatch, distinct capture/removal/
absence/network causes, secret-bearing exceptions, ordered fallback
projection, and actual default/admission rejection through existing tests.
All Docker-looking calls in test fixtures are intercepted; the only
executed native fixture is Node. No real Docker fallback is allowed.

### Committed source and preservation proof

Implementation, tests and the in-place RCA are committed as
`9f8d491169bdc07769b1c17515c751ec1a4d6466`.
The following source-only command passed after that commit:

```powershell
node test-results\os17-source-finalization-20261023\preservation.cjs `
  committed source-preservation.json
```

Its exclusive output
`test-results/os17-source-finalization-20261023/source-preservation.json`
has SHA-256
`497b51e6d6bf9be1cb2e9d6d101f180c48c942f1bcd47d6ed180d97808e4395e`.
This is **source preservation evidence, not a new functional receipt**.

| Verified identity | Result |
|---|---|
| Original attempt2 intent, manifest, INVALID receipt and separate recovery receipt | All four match their retained hashes byte-for-byte |
| Original seven frozen inputs | Each matches its manifest's original on-disk hash and executed commit after newline normalization |
| Current seven changed CJS inputs/tests | Each matches implementation commit after newline normalization. Every raw disk/Git comparison is false because disk CRLF and Git LF differ; raw equality is not claimed. |
| Current functional runner on-disk SHA-256 | `ebb87efb7229d3cde6d3ba52574eef1418dfac2725c220cb16a9b8a8d3293085` |
| Current functional runner Git SHA-256 | `335fb8dc15c9931d66ea12fdd5fe7421bee04158d05a4c6bc85fbc748e1ab5d5` |
| Normal qualification runner, assessor, protocol, benchmark, PG fixture and DERIVED proof helper | All six remain unchanged from `3563b5e4` after newline normalization |
| Local qualification ref | Still `d25b6155bace7af2ec4ccb89f2eb0048e2db0c26` |
| Branches/stashes | All 90 local branches and ten stashes retained; no branch/history/stash operation performed |

The final phase-only correction has targeted GREEN evidence in addition to
the eight earlier new cases. There are nine unique new lifecycle cases and
54 existing focused cases covered in the retained runs. The failed aggregate
commands remain failed evidence; no single clean 63-case aggregate is
claimed. No additional aggregate was run merely to replace that evidence.
The final closeout is documentation-only, not another source or runtime
iteration.

One additional fake-subprocess hypothesis was checked before closeout:
could ignoring graceful termination overrun the remaining cleanup time?
The exploratory wrapper test failed an over-specific `SIGKILL` expectation,
returning actual `SIGTERM` instead
(`termination-edge-red.log`: one executed, one failed, zero skipped;
12,432.6389 ms includes the existing 11-second metadata fixture).
This was **not evidence of a deadline overrun**. A separate bounded native
Node fixture on `win32`, with a `SIGTERM` listener and an independent
1,800 ms safety exit, was terminated at 1,230 ms under its 1,200 ms timeout;
the closed safe classifier retained `terminated`/`SIGTERM`.
Its output is `termination-edge-observation.log`.
No Docker command was involved. The exploratory signal-policy assertions
were removed, restoring the committed test exactly; no speculative kill
policy was added. This observation establishes neither Linux behavior nor
the destroyed historical native cause. An initial PowerShell quoting error
was rejected by the parser before the fixture started; stdin script input
corrected that tooling friction without changing source or time limits.

Final documentation validation is retained in
`freshness-final-closeout-content.log`:
`pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling`.
It is the 27-document **content-only** check, not the full coupled gate.

### RCA, escape analysis and remaining holds

| Issue | Root cause and resolution | Detection and earliest useful check |
|---|---|---|
| OS-17 / DF-12, evidence loss, High | Native wrappers replaced native failures with generic errors; the shared finalizer then reduced them to booleans. Closed cause metadata, per-action ordered retention and safe fallback projection are now applied. The actual historical inner code remains unknown. | Runtime finalization exposed the gap; a real failed native-child finalizer test could have caught it before any container run. |
| OS-17, timeout asymmetry, Medium | Cleanup selected the right absolute deadline but imposed a ten-second maximum versus thirty seconds for work. The exact frozen-wrapper counterexample proves that an otherwise timely 11-second metadata operation was rejected. Corrected functional source uses the existing thirty-second maximum within the unchanged outer cap. | Source inspection plus frozen-body native-child RED/GREEN; not a reconstruction of the actual failed metadata call. |
| OS-17, cause projection, Medium | Initial new projection overwrote a validated underlying budget phase with caller intent. A targeted assertion failed before correction; projection now retains the underlying phase. | New focused test during source correction, before runtime. |
| OS-17 validation friction, Low | Parallel coverage and later serial coverage encountered existing short child time bounds. Four remaining failures passed in isolation at unchanged limits/source. Timing variability is observed; no particular shared host process or Windows mechanism is proven responsible. No application or performance retry occurred. | Focused regression; explicit test counts prevented a timed-out/no-result child from being counted as passing. |
| OS-17 static gate, Low | An explicitly caught throw inside finalization still violated `no-unsafe-finally`. Reused a small absence guard across actual inventory callers; the seven-rule scoped gate now passes. | Static gate, before commit or runtime. |

**Self-improvement: applied.** The new executable regressions assert actual
safe causes and budget phases, not merely that cleanup was attempted.
The safe schema rejects arbitrary exception fields and distinguishes final
capture, native removal, and absence verification. The central engineering
ledger records the pattern.

**Design/architecture disposition: accepted.** This is one cohesive
diagnostic-finalization correction using the existing finalizer and privacy
module. Closed metadata and pure budget/ownership guards are shared by real
callers; no pluggable lifecycle framework or speculative policy seam was
introduced. The functional orchestrator remains a large existing file;
splitting it during this forensic correction would add unrelated risk.

**Provenance/completeness:** this RCA was reconciled against the retained
frozen inputs, original safe receipt, recovery receipt and every local
RED/GREEN/static output produced for this source-only correction. No full
original conversation transcript is available through a session-log
pointer; this is not a claim of reconstructing destroyed native/private
evidence. Host-specific attribution and speculative inherited-abort
explanations are explicitly not established.

The next bounded engineering action is review of these source changes and
their preserved failure evidence. Any future functional invocation requires
separate authorization and fresh preregistration. Nothing here approves
reference adoption, artifact qualification, publication, PR #251, performance
admission, customer-data/migration/capacity checks, cloud deployment or
production promotion. No new live cleanup verification is claimed; the
previous exact-owner recovery remains the last verified inventory.

## Corrected-source functional continuation (2026-10-23)

**Outcome: INVALID.** Strict privacy subchecks passed, but final capture and
removal failed; mandatory safety cleanup finished after the original cap.
The DERIVED artifact remains functionally unqualified.

One new `attempt2` invocation was authorized and executed for the same
immutable DERIVED artifact after the PG optional-label correction. This is not a replacement
for a failed privacy workload: attempt1 allocated zero resources and made
zero HTTP requests or SQL calls. Its INVALID receipt and absent manifest
remain unchanged. The new invocation must record its own committed source,
exclusive preregistration, full resolved manifest and frozen inputs.
No original/candidate app, build, performance experiment or baseline
adoption is authorized.

Actual bounded child tests now prove that deliberately failing fake metadata
leaves an exclusive intent containing source hashes, requested immutable
images, the hypothesis and unchanged caps. The safe INVALID receipt has
zero allocations, readiness probes and requests. Two further real child
negative controls tamper with the full resolved manifest or a frozen input;
both must stop before any resource creation. No test-only production flag
or new production abstraction was added. Full manifest readback must equal
the intended complete object, and every frozen input must match its hash,
before network creation or container start.

Evidence root: `test-results/derived-functional-continuation-20261023/`.

| Command | Actual result |
|---|---|
| `node --test --test-name-pattern="real bounded functional child" scripts\test\membership-derived-functional.test.cjs` before manifest guard | RED: three real tests executed, one passed and two failed on attempted resource creation after tampering; zero skips. `red-resolved-seal.log` |
| Same filtered command after the guard | GREEN: three real tests executed, three passed, zero skips; `green-real-child.log` |
| `node --test scripts\test\membership-derived-functional.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-statements.test.cjs` | 34 passed, zero skips; `green-focused.log` |
| `node test-results\derived-functional-20261023\validate.cjs ..\derived-functional-continuation-20261023\static.json` | Six syntax checks and scoped seven-rule ESLint passed, zero errors; `static.json`. Not the full normal lint configuration. |

| Issue | Root cause, fix and prevention | Detection / escape |
|---|---|---|
| DF-10, test harness / Low | The first child shim assigned to Node's non-writable custom-promisification property, so interception did not take effect and three children hit their ten-second bound. Git dirty-source rejection occurred before intent/fixture creation; its read-only cleanup inventories could use the real CLI. The corrected shim replaces the function, installs an explicit custom property and asserts promisification identity before entry. The subsequent three real child cases execute in under four seconds collectively and never dispatch real Docker. | Test execution, before the authorized invocation; the failed harness output remains in `red-real-child.log`, not counted as behavioral RED. |
| DF-11, evidence-integrity guard / Medium | Static ordering did not prove that the resolved manifest or frozen bytes were checked before allocation. Actual tamper children reproduced attempted creation after drift. Minimal DERIVED-only readback/equality and frozen-byte verification now reject both cases before any allocation. The default/admission path is unchanged. | New real-child negative controls; closed before the one corrected-source invocation. |

Self-improvement disposition: **applied**, executable failure/tamper paths
replace reliance on source ordering alone. Design disposition: **accepted**,
small inline checks at the existing diagnostic sealing boundary; no new
framework, test-only production option or speculative shared seam.
### Actual attempt2: privacy subchecks passed, overall INVALID

The single authorized corrected-source invocation ran from committed
`e0d884b97bf74d629da717d4678c96a6240fcdd5`:

```powershell
node scripts\performance\run-membership-privacy-functional.cjs `
  --derived-reference-functional-only `
  test-results\derived-functional-continuation-20261023\attempt2
```

Run `2612d0d3bceb46b5a27ea7d6fbc38016` started at
`2026-10-23T21:57:42.131Z`. The runner exited 1 after **228,079 ms**.
It did not encounter the previous PG metadata defect and did reach the
functional requests. It remains **INVALID**, not artifact-privacy-qualified:
strict final capture/removal evidence failed. Mandatory exact-owner cleanup
was subsequently recovered at **350,556 ms** from the original start,
outside the five-minute cap. The cap was not resized, and recovery does not
repair or replace the original receipt.

| Check | Actual observation | Meaning |
|---|---|---|
| Preregistration | Exclusive `intent.json`, full resolved `manifest.json` and seven frozen inputs exist; manifest readback/frozen-byte checks precede allocation | The previously missing evidence boundary is now exercised, not backdated into attempt1 |
| Immutable artifact | App image `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4`; original pinned build/source proof verifies | Only the separately identified DERIVED artifact ran |
| Fixture | One new owned PostgreSQL 17.11 and one DERIVED app; actual app CPU 0.5, memory 1 GiB, no OOM reported in initial metadata | No original/candidate app or new image build |
| Readiness | Ten runner probes, ending with HTTP 200; limit remains 15 | No readiness replacement loop or expanded limit |
| Effective persistence | Actual app environment is string `'false'`; independent stored endpoint policy is boolean `false` | Both required policies were verified, not merely requested |
| Authenticated requests | Exactly seven: endpoint create 201, endpoint policy PATCH 200, Group create 201, Group PATCH 200, missing Group GET 404, missing Group PATCH 404, flush 204 | All expected legacy-supported status contracts were met |
| Correlated rows | Four distinct request IDs match the owned endpoint, exact methods/routes/statuses; each has authorization present and redacted | Absence was not counted as a required mask |
| Generated credentials | Strict checks passed for all five generated static roles across selected rows, complete app console, complete PG console and tool console; tool output scanned again after cleanup attempts | A passing privacy subcheck, not a waiver of final evidence or admission |
| Original final captures | App capture failed; PG capture succeeded; both removal/absence rows failed | The required two successful final captures and verified cleanup were not achieved in the invocation |
| Recovery | Fresh exact-ID/image/owner/run checks preceded removal of only those two containers and their network; independent inventories are empty | Safety cleanup completed, but after the original cap and without changing the INVALID receipt |

The five generated credential roles were `postgres-admin-password`,
`scim-shared-secret`, `jwt-signing-secret`, `oauth-client-secret` and
`credential-encryption-key`. Their values, matched context, lengths and
credential hashes were not exported. Raw headers and complete consoles
remained memory-only. No SQL timing, statement probe, performance samples,
baseline adoption or deployment occurred.

### What failed, and what is still unknown

The earliest recorded failure is the app's final metadata capture
(`captureError=true`), followed by removal failures for both resources.
The closed outer failures are `cleanup-network / NETWORK_CLEANUP`,
`cleanup-inventory / INVENTORY` and
`derived-cleanup-evidence / INCOMPLETE_CLEANUP_PROOF`.
The shared finalizer retains booleans rather than the inner exception code,
so the original capture/removal exception cannot be reconstructed.
This is the existing OS-17 observability gap, not evidence of a new
application privacy defect.

Source inspection confirms a ten-second per-command cleanup limit.
The later exact-owner recovery's public-metadata inspection took
10,926 ms, with its other CLI calls taking 8,145-9,574 ms.
That is consistent with CLI startup latency exceeding the cleanup command
bound, but it does **not** prove the original swallowed exception was a
timeout. These are collector/lifecycle observations, not request-latency
measurements or performance evidence.

| Issue | Evidence, disposition and prevention | Detection / escape |
|---|---|---|
| DF-12, finalization / Medium | Actual privacy checks passed but strict app final capture and both removals failed. Exact owned recovery removed the two containers/network and independently verified absence at 350,556 ms, beyond the original cap. Original receipt stays INVALID. OS-17 cause retention and bounded commands were scheduled at this closeout; the new source-only correction above now applies that follow-up without qualifying or rerunning the artifact. Keep both final captures, owner checks and the five-minute cap. | Actual finalization, after successful privacy checks; executable slow/failing lifecycle-child coverage could expose the missing cause/budget interaction earlier |
| DF-13, closeout checking / Low | The first independent inventory assertion compared all containers, including five unrelated stopped IDs, against a preflight that recorded only running containers. It failed without mutation. Corrected comparison uses the same running scope, while separate all-state exact-run queries still require zero owned resources. Preflight did not record the stopped IDs, so their creation time is unknown; none was touched. | Independent preservation check; corrected scope verifies the original three running containers and empty owned inventories |
| DF-14, tooling / Low | Initial combined reads exceeded display limits, and one later bounded read requested lines beyond EOF. No generated temporary-output file was opened; narrower original-file reads and an exact source lookup recovered the needed context. No runtime or source behavior changed. | Immediate tool feedback; no application escape |
| DF-15, test portability / Medium | The new child tests depend on ignored local immutable build evidence and would fail rather than report unavailable evidence on a fresh checkout. Test-first availability handling now explicitly skips those three cases when the proof is absent, matching the existing retained-proof test convention. A bounded isolated availability probe proves three skips; with actual local proof, all three real tests still execute and pass. No local runtime requirement or guard was weakened. | Post-run test review before commit; no remote invocation |
| DF-16, native test context / Low | The initial isolated availability probe inherited `NODE_TEST_CONTEXT` and returned no test output despite exit 0. Test-count assertions rejected that false green. Clearing only that inherited context for the bounded independent native test process yields the expected three-test accounting. Existing non-UTC child/parent bounds are unchanged. | New portability probe, before acceptance; retained `red-portability.log` |

### Frozen identity and independent closeout

The new on-disk hashes are:

| Evidence | SHA-256 |
|---|---|
| Intent | `3ee5c7172fd9e2f0f9821b349582e11ad1c35aa141520fad83ac7e36fade9209` |
| Full resolved manifest | `c51156c438b3d527101af7b3b80a0242db94eb49b0f910be94f1bab8bfcef7be` |
| Original attempt2 INVALID receipt | `c0539898e82e491fc7481dca125a8343dea888d1dccf8cea0440b9d89bdd44f8` |
| Separate safety-cleanup recovery | `281ec91fa4380b7bb3ff234ffbdecc70b337b0204c2d47a44c44ac57c56ed354` |

Runner disk SHA-256 is
`e739b14d99dcba844f40c70b47d112b5af131957689f1e3bba83bde924940959`;
its Git-normalized hash is
`11fa1c3e63a6f01b28adb5a5f13d9a6fc22aa1148ade71a948e0ce1c384932ac`.
Raw bytes differ, but newline normalization matches for all seven inputs.
The manifest also pins Node v24.13.0 and pg client 8.22.0.

`closeout-proof.json` verifies both new sealed records and earlier retained
manifest/build proof hashes. Attempt1's receipt remains
`0d42ce93932add958e17a2a02a2ee7de6c815c8d506c26416468e6f177058ab7`,
and its manifest remains absent. Phase1, observer, original phase2 and
earlier privacy evidence were not rewritten.
The same three shared running containers are untouched; exact owned
container/network inventories are empty. Ninety local branches, ten
stashes, local qualification `d25b6155` and origin qualification
`f6f03a52` remain preserved. No push, remote CI, PR mutation or cloud
operation occurred.

Self-improvement disposition: **applied** real-child preregistration/tamper
guards and scope-correct independent inventories; **scheduled** OS-17
safe-cause and bounded-finalization follow-up as DF-12 above.
Design disposition: **accepted**, no speculative shared-finalizer
refactor bundled into this bounded run. There will be no automatic further
functional invocation. The artifact remains functionally unqualified,
and baseline adoption, publication, timing comparison and release admission
remain held.

Post-run test-only portability validation used
`node --test --test-name-pattern="real bounded functional child|local real-child regressions" scripts\test\membership-derived-functional.test.cjs`:
four executed, four passed, zero outer skips. Three are the actual
retained-proof child controls; the fourth independently verifies three
explicit skips only when proof is declared unavailable. The behavior RED
and GREEN are retained in `red-portability-assertion.log` and
`green-portability-and-real-child.log`. Six-file syntax/scoped lint
remains green in `static-postrun-tests.json`. No production input changed
after the actual invocation, and no additional functional run occurred.
Content-only freshness passed 27 documents with `-SkipCoupling`, retained
in `freshness-final-content.log`; this is not the full coupled gate.
No full debug-transcript pointer is exposed; RCA reconciliation covers
the retained commands/results and visible activity, not an asserted
complete earlier-session transcript.

## Functional qualification of the DERIVED artifact (2026-10-23)

One functional run of the immutable local DERIVED image was authorized,
not production-baseline adoption, an original-image retry or a performance
experiment. Its sole invocation stopped INVALID in metadata preflight,
before fixture creation; functional privacy remains unqualified.
The explicit entry is
`--derived-reference-functional-only`; default, unknown and incomplete calls
reject before Docker dispatch. The build manifest, successful receipt and
original unstarted source proof must match their pinned byte hashes.
The app is requested by immutable image ID `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4`,
not by its local tag; actual image identity and DERIVED labels must match.
This reuses the completed whole-distribution proof without hashing it again.

The fixed functional policy retains at most seven authenticated requests,
15 readiness probes and five minutes including a 120-second cleanup
reservation. Prospective corrected source writes an exclusive intent before
metadata inspection and a full frozen manifest before owned fixture creation.
The executed attempt did not reach either write; its missing preregistration
is documented below, not retrospectively repaired.
Server false is checked independently from stored endpoint false before
four correlated Group requests. All four exact authorization masks remain
mandatory. Selected rows and complete app, PostgreSQL and tool console inputs
are separately scanned in memory for every generated credential; missing or
empty console input rejects. No raw console/header material is exported.
Only this new artifact can receive functional privacy qualification; original
privacy failures and all performance/admission holds remain unchanged.

### Prospective statement fixture correction, not an executed diagnostic

The old statement fixture omitted both explicit false policies while requiring
masked rows. Future statement source now requests server false at app startup
and verifies its actual environment. An opt-in workload IPC gate pauses after
endpoint creation, before User/Group setup and all counter windows. The parent
uses the supported endpoint PATCH to set false, independently reads the stored
policy, then acknowledges the gate. Missing, true or string `"false"` stored
values reject. This additional setup HTTP request and administrator policy
read are reported separately; the original 4,407 checked child requests,
payloads, cycles, samples and default/admission behavior remain unchanged.
No statement diagnostic is authorized or executed here.

### Focused evidence and preparation issues

Evidence root: `test-results/derived-functional-20261023/`.
Initial RED retained three failed new guard tests and one existing default/
admission rejection success. After implementation, the five-file focused
selection passed 80 tests with zero skips; a final five-test targeted run
passed after scope correction. The actual bounded workload child test rejects
the fixture-policy acknowledgement and proves zero User/Group requests or
timing samples, with successful fake-fixture cleanup. Negative controls reject
the old omitted statement policy.
After final private-structure and cleanup-evidence negative controls, the
four-file source/privacy selection passed 30 tests with zero skips. Six-file
syntax and scoped correctness lint remain green. All checks are local and
unreleased, with no dependency restoration.

| Issue | Cause, correction and prevention | Detection stage |
|---|---|---|
| DF-01, tooling / Low | A shell wildcard was passed as a literal ripgrep path and an endpoint service was sought outside its `services` directory. Corrected bounded path discovery located the DTO and source. No production behavior was involved. | Source exploration; earliest applicable stage |
| DF-02, source correctness / Medium | The new policy callback initially referenced `pgPort` declared inside the later try block. Scoped `no-undef` caught it; the port now lives in the enclosing runner scope. | Static gate, before any fixture or timed workload; no runtime escape |
| DF-03, checking-tool correctness / Low | The scoped lint harness initially omitted Node's standard `URL` global and flagged unchanged code. Declaring that real global removed the false positive without disabling a rule or editing the application. Six-file syntax and scoped seven-rule lint then passed with zero errors. | Static harness; earliest applicable stage |
| DF-04, privacy telemetry / Medium | An undefined selected row serialized to undefined and reached the shared missing-input guard without its row index; a null console collection would have raised a generic TypeError. Targeted RED reproduced the lost row attribution. The new validator now rejects serialization and console-collection shape through the closed source/kind schema, retaining the applicable row index. Thirty focused tests pass after the fix. | New negative control before functional execution; no runtime escape |
| DF-05, qualification safeguard / Medium | The existing finalizer intentionally reports removal verification independently from final metadata capture. A new DERIVED result must not count verified absence as complete final evidence. RED/GREEN added a narrow qualification check requiring both owned resources captured, removed and independently verified. The shared finalizer and its OS-17 observability limitation are unchanged. | Source review and new negative control before execution |

Self-improvement disposition: **applied** immutable-proof drift tests,
closed source/kind privacy negatives, old-policy negative controls and a real
pre-window IPC failure test. Design/architecture disposition: **accepted**:
shared two-policy checks live in the existing statement privacy module, with
two actual callers; the statement runner does not depend on DERIVED build
identity tooling. No speculative framework or shared cleanup refactor.
The sole functional invocation stopped INVALID during metadata preflight;
the actual result and tested-but-unexecuted source correction follow.

Reproducible validation commands and retained results:

| Command | Result |
|---|---|
| `node --test scripts\test\membership-derived-functional.test.cjs` before implementation | RED: three failures, one existing rejection test passed; `red.log` |
| `node --test scripts\test\membership-derived-functional.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-statements.test.cjs scripts\test\membership-performance.test.cjs` | 80 passed, zero skips before the final narrow guards; `green-focused.log` |
| `node --test scripts\test\membership-derived-functional.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-statements.test.cjs` | Final 30 passed, zero skips; `green-source-final.log` |
| `node test-results\derived-functional-20261023\validate.cjs static-source-final.json` | Six syntax checks and scoped seven-rule ESLint: zero errors. This is the retained exclusive-output invocation, not the unavailable full normal lint configuration. |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | Before execution, passed 27 documents; `freshness-source-content.log`. Content-only, not the full coupled gate. |

The `--test-name-pattern` RED invocations and exact safe assertion stacks
are retained in `red-private-structure.log` and `red-cleanup-proof.log`.
No full suite was duplicated. Full-transcript reconciliation is unavailable
because no debug-log location is exposed; this new issue list is reconciled
against the retained commands and outputs of this bounded activity, not
claimed complete for earlier sessions.

### Sole actual invocation: INVALID before fixture creation

Executed committed source: `1ac355932a2625f0df15a2798b423964437f8519`.
Run ID: `8032f52ecc0546b780b49421da6df9b5`.
The command was:

```powershell
node scripts\performance\run-membership-privacy-functional.cjs `
  --derived-reference-functional-only `
  test-results\derived-functional-20261023\attempt1
```

It exited 1 after **27,828 ms**, with zero authenticated requests, zero
readiness probes, zero app/PostgreSQL containers allocated, zero SQL and no
performance samples. The safe receipt records `preflight / OWNED_DOCKER`.
The two-resource completion safeguard also emitted
`derived-cleanup-evidence / INCOMPLETE_CLEANUP_PROOF` because the allocated
set was empty. That second finding is not evidence of leaked resources.
Both independent owner inventories were empty and no network was created.
The derived artifact has **not** received functional privacy qualification.
No original or candidate app started, and no replacement run was attempted.

**The requested preregistration was not fully achieved.** The implementation
placed its full `manifest.json` write after image metadata inspection, so
that file and its frozen-input directory do not exist for this attempt.
The hypothesis, fixed limits and immutable image/proof binding were in the
pre-run source commit, but that is not a substitute for the requested
on-disk preregistration. No manifest has been backdated or reconstructed as
though it existed before execution.
Before correcting source, unchanged executed bytes were copied into
`attempt1/postrun-executed-source/` and sealed in
`attempt1/postrun-source-proof.json`, explicitly marked captured after the
run and not preregistered. For the executed runner, on-disk SHA-256 is
`6fa2208b59f6554de0ed0042c262fe94cf2234db78444a82dcde0ce723813a36`;
Git-normalized SHA-256 is
`60291a6e677e4e79174420e314b68c3e8552dbb25c80bba5e2509c44aec3ce23`.
Raw bytes differ; all seven retained inputs match after CRLF normalization.

### Actual failure diagnosis and prospective correction

Read-only metadata diagnosis, not another functional fixture, established:

1. The exact DERIVED image ID resolves with the expected labels, parent,
   platform and digest. The local artifact is present and unchanged.
2. The newly extended metadata template asked **both** images for
   `.Config.Labels`. The exact cached PostgreSQL image omits that optional
   key. Replaying that metadata-only command returns
   `map has no entry for key "Labels"`.
3. Role-specific formatting retains mandatory labels for the DERIVED app
   but does not request optional PostgreSQL labels. A single metadata-only
   correction check on the same cached PG image returns exit 0, its exact
   pinned ID/digest and `linux/amd64`.

The original Docker stderr was withheld by the existing generic wrapper and
was not recovered. The deterministic source-level PG formatting defect is
confirmed by the later metadata-only reproduction; this is not a claimed
reconstruction of the destroyed original stderr. There is no evidence here
of an application compatibility or application privacy failure.

| Issue | Root cause, fix and prevention | Detection / escape |
|---|---|---|
| DF-06, harness compatibility / Medium | A DERIVED-label requirement was mistakenly imposed on the PG image metadata query. Real PG metadata inspection rejected an omitted optional key. RED/GREEN now tests role-specific formatting, keeps all DERIVED app labels mandatory and verifies the corrected PG-only command succeeds. | Functional preflight caught it; an image-role capability check could have caught it before the sole invocation. No app or data-plane escape. |
| DF-07, evidence ordering / Medium | The full frozen manifest was written only after metadata preflight, losing the on-disk preregistration when that preflight failed. A new exclusive `intent.json` is now written before any Docker metadata command, including source commit/input hashes, immutable requested images, hypothesis and fixed limits; the full resolved manifest still precedes fixture creation. Static ordering regression added. This correction has not been functionally executed. | Discovered while inspecting the failed attempt; earliest gate was source-ordering review. The missing historical manifest stays missing. |
| DF-08, tooling / Low | An inline Node diagnostic hit PowerShell string-escape parsing (`Invalid string escape`) before calling Docker. Moving the public-image-only command into a retained native Node script removed shell interpolation. It did not allocate a resource or repeat functional requests. | Immediate syntax error; earliest possible stage |
| DF-09, result classification / Low | The new cleanup completeness guard assumed two allocations even after an early zero-allocation failure. It now checks the actual allocated count; a fully completed run still necessarily has two owned resources. Negative control distinguishes empty verified cleanup from incomplete final capture. The old receipt remains INVALID with both original findings. | Safe-receipt review after preflight; could have been caught by a zero-allocation failure test |

After these prospective corrections, the same four-file focused selection
passed **31 tests, zero skips**, and six-file syntax/scoped correctness lint
passed with zero errors. Exact outputs are
`green-postrun-correction.log` and `static-postrun-correction.json`.
The post-run static command was
`node test-results\derived-functional-20261023\validate.cjs static-postrun-correction.json`.
The source tests used the four-file command above.
Public-image metadata command arguments and outcomes are retained separately
in `metadata-diagnosis.json`, `metadata-pg-diagnosis.json` and
`metadata-pg-correction.json`; none starts a container or SQL connection.
These successes do **not** replace the INVALID functional result.

The tested, functionally unexecuted correction is committed locally as
`462365dbe3c51614d658a6169411bcb6342dd4c5`, separate from executed
`1ac355932a2625f0df15a2798b423964437f8519`.
Post-run content-only freshness passed 27 documents using
`pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling`;
`freshness-postrun-content.log` retains its result. This is not the full
coupled documentation gate.

### Independent closeout preservation and cleanup

`test-results/derived-functional-20261023/closeout-proof.json` records a
read-only final check. The exact run has zero remaining owned containers
and networks. The same three unrelated shared containers remain running,
untouched. Original baseline, unchanged current candidate and local DERIVED
image identities still match their immutable references. The three sealed
build/source proof hashes, earlier retained manifest hashes and all seven
post-run preserved executed inputs verify. No application distribution
rehash, container startup, SQL, build or functional replacement was performed.
The 90 local branches and ten stashes are preserved; local qualification
remains `d25b6155bace7af2ec4ccb89f2eb0048e2db0c26` and its origin reference
remains `f6f03a523b6370eccc63f1499c3c111dd5cdf200`.

The actual INVALID receipt SHA-256 is
`0d42ce93932add958e17a2a02a2ee7de6c815c8d506c26416468e6f177058ab7`.
Its absence of a manifest remains explicit in the closeout proof.
The artifact is stored locally but **functionally unqualified**; adoption,
publication, performance and deployment remain held.

Self-improvement disposition: **applied** role-specific optional-metadata
tests, preregistration-before-preflight ordering and zero-allocation cleanup
tests. Design disposition: **accepted**, narrow opt-in helper changes only;
no default/admission image switch, generic cleanup refactor or new framework.
Next engineering action is a separately authorized new bounded functional
check of the corrected source. There is no authorization here for another
attempt, baseline adoption, statement execution, performance or publication.

## Offline DERIVED reference preparation, not baseline adoption

**Exact-image source proof now confirms the known raw database-URL startup
emitter.** One explicitly owned, never-started container was created from
the cached immutable 0.55.20 parent. Its exact compiled Prisma file has SHA-256
`00ea9943fb8f6ecf296b34af5c9072d447b346d15b213669ba83d1f422f92c33`
and contains both logging statements corrected by reviewed commit
`5896771677e3a67308160d2853c69349ad4188c3`. This strengthens the earlier
release-associated source evidence; it still does not reconstruct any
destroyed matched runtime line or OS-07 row.

The source container remained in `created`, with `Running=false` and a zero
start timestamp. Its entire `/app` distribution was copied as a sealed archive
without starting an entrypoint, health check, application, Node or PostgreSQL
process. Ownership-checked removal and a separate empty inventory check
succeeded. Evidence is retained in
`test-results/derived-reference-20261023/source/`.

An explicit-opt-in local builder,
`scripts/performance/build-membership-privacy-reference.cjs`, produced
the separately named **DERIVED** privacy reference. It does not modify
the frozen baseline protocol, existing images, application-reported version,
admission logic, request paths, SQL, dependencies, fixtures or resource limits.
The only intended content change is removal of the known successful-startup
database-URL message and replacement of its fallback warning with the
reviewed static warning.

The complete original compiled-file hash and exact startup-statement source
hash are pinned before transformation. The resulting compiled-file hash must
be exactly
`f558ea53e53492776ed88fc7f44ee36e30a2a706025703264ca071e6b3c68c24`.
These are hashes of source files/statements, not generated credentials.
No displayed/redacted source literal is used as a replacement authority.

The recipe uses the exact cached parent, no external Dockerfile frontend,
`--pull=false`, `--network=none`, no `RUN` or npm steps, fixed copied-file
timestamps and `SOURCE_DATE_EPOCH=0`. Only the approved compiled file is
copied, preserving its actual mode, UID and GID. New labels disclose DERIVED,
parent, source commit and no runtime qualification/admission. A unique local
tag prevents overwriting any tag. One build is bounded by five minutes with
45 seconds reserved for cleanup; no retry or application startup is dispatched.

Verification compares the whole application path set, file bytes, links,
modes and ownership, allowing exactly that compiled-file delta. It also
requires unchanged parent filesystem layers, exactly one added layer and
identical nonlabel image runtime configuration. Application file timestamps
are not compared, and reproducibility of a second build will not be claimed
from this single authorized build.

### Preparation issues and prevention, captured before the build

| ID | Type / severity | Actual issue and resolution | Detection / prevention |
|---|---|---|---|
| DR-01 | Tooling / Low | The installed `docker buildx inspect` rejected `--format`. Supported plain inspection established the existing running `docker` driver and BuildKit v0.33.1, without bootstrap or installation. | Capability probe before build; no unsupported flag is used in the recipe. |
| DR-02 | Source-proof correctness / High | A tool-rendered startup literal contained a masking placeholder not present in the exact source. Synthetic fixtures passed, but the actual-source preflight failed `Exact reviewed statement count` with `0 !== 1`. The correction pins full compiled bytes plus the complete startup-statement source hash, then removes the exact in-memory statement; no credential-bearing source literal is copied into new tracked code. | Actual-source RED and seven-test GREEN, with zero skips when `DERIVED_REFERENCE_SOURCE` points to the retained extraction. A synthetic fixture alone is not exact-image proof. |
| DR-03 | Image metadata compatibility / Medium | The first committed preparation stopped after 22.293 seconds because the image JSON omits optional `OnBuild`, while the guard required explicit null. The retained `build1/receipt.json` is INVALID. No build command, frozen build manifest, derived image or verification container was created. Explicit absence, null and an empty array now mean no declared inherited instruction; any present unknown value or nonempty array still rejects. | Source-only structural replay proved field omission. Targeted RED preceded the correction; eight builder tests, including the exact extracted source, then passed with zero skips. Two-file syntax/scoped lint also passed. This correction precedes the one actual build and does not reinterpret the failed preflight. |

Self-improvement: **applied** actual extracted-source validation alongside
synthetic drift, missing/duplicate statement, archive-framing, whole-distribution
and real-child default/admission rejection checks.
Design/architecture disposition: **accepted** one cohesive opt-in source/build
tool using native Node and Docker; no generic patch engine or framework seam.
The existing OS-17 capture-observability follow-up remains separate.

### Actual local artifact and proof

**Status: DERIVED_BUILD_VERIFIED, source/build proof only.** The one actual
Docker build and unstarted verification finished in 150.417 seconds, including
owned verification-container cleanup, below the fixed five-minute limit.
The earlier 22.293-second INVALID preflight dispatched zero builds; both its
receipt and the later build receipt are preserved in different directories.

| Identity or proof | Actual result |
|---|---|
| Local named deliverable | `scimserver-local:0.55.20-privacy-reference-derived-1b39d0d7-86f` |
| Local image ID / emitted manifest digest | `sha256:4a4b0ec7daccd00dcbb62108218389d25f1400fe9468022c52dcaea0745846c4` |
| Emitted image config digest | `sha256:2c54358449ffe03dec98400e27e649473843068c8511e350a353e5d7fc71da91` |
| Exact cached parent reference | `ghcr.io/pranems/scimserver@sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a` |
| Observed parent platform image ID | `sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`, `linux/amd64` |
| Executed builder source commit | `b7fdb9c6afa576057abcc38731cc4f271fb74e41` |
| Frozen manifest SHA-256 | `100490fd58eec02c9fec29169a6d25882a475920fdc8a136d8c08a5ab9a2fd54` |
| Receipt SHA-256 | `b0fd28138a4f622927d5816ea8180e7edb87a792be5e39b0e58b6a5596d03a9d` |
| Dockerfile recipe SHA-256 | `bea96a0fe7fd8766a33476c741f9aad83b92de4d9a8d1f3faf23966066bd0cab` |
| Application distribution | All 13,678 entries compared: 12,011 regular files, 11 symlinks and 1,656 directories. Exactly one regular-file content/size delta, the pinned Prisma logging file; all other entries and compared metadata identical. |
| Approved compiled delta | Original 4,020 bytes / hash `00ea9943...`; derived 3,848 bytes / hash `f558ea53...`, matching the full pinned hashes above |
| File metadata | Original and derived mode `0644`, UID/GID `1001:1001`; symlink targets and all non-target file hashes unchanged |
| Inherited runtime | Parent filesystem layers identical, exactly one added COPY layer, all nonlabel image runtime configuration identical |
| Version and labels | Package-declared `0.55.20` retained; new image labels explicitly disclose DERIVED, parent, source commit, no admission eligibility and no runtime qualification. No version endpoint was invoked. |
| Deterministic controls | Fixed copied-file/image creation epoch observed; no second build was performed, so repeated-build reproducibility is not empirically established |
| Tools | Host Node v24.13.0; Docker 29.8.2; buildx v0.37.2; existing Docker-driver BuildKit v0.33.1 |
| Image-declared Node | `NODE_VERSION=24.20.0`; read from cached image metadata, not asserted as a newly executed binary version |
| Cleanup | Original source and derived verification containers both removed, with independent empty owner-label inventory. No application, PostgreSQL, health-check or entrypoint process started. |

The authoritative executed input is the frozen on-disk builder file:
SHA-256 `1d72a8dfd9404c7d500f577d78e715228b0a08a1d689857b7ef80b5e300c09ec`.
The committed Git blob has SHA-256
`60a9a22f1ba8f3d41f0c6198c0893adf9e83913b7c41f53bfe5f6d4da8412532`.
They differ as raw bytes and match after CRLF-to-LF normalization; raw-byte
identity is not claimed.

Actual provenance command, not permission to rerun it:

```powershell
node scripts\performance\build-membership-privacy-reference.cjs `
  --build-derived-reference `
  test-results\derived-reference-20261023\source `
  test-results\derived-reference-20261023\offline-build
```

That output directory is exclusive and already exists. The build log records
a cached parent, a 3.88 kB context and one COPY step; there are no RUN,
package-install or downloaded-layer steps. The exact Docker arguments,
`--pull=false`, `--network=none`, fixed epoch and source/recipe hashes were
frozen in `offline-build/manifest.json` before the build. No frontend was
downloaded. Packet-level daemon network activity was not independently
instrumented; `--network=none` governs build-step networking, not a claim that
packet capture proved the daemon made no metadata lookup.

Evidence root: `test-results/derived-reference-20261023/`.
The successful `offline-build/` directory holds `manifest.json`, `receipt.json`,
`build.log`, `image-id.txt`, the frozen executed builder, exact Dockerfile and
corrected compiled input, both complete distribution manifests, and the
unstarted derived application archive. The separate `source/` directory holds
the original exact source, full archive, unstarted identity proof and exact
extraction commands. The named local image remains as the requested build
deliverable, not a deployment.
`closeout-proof.json` independently seals the source-extraction script/proof,
frozen builder, exact recipe, both application archives and compiled input;
all checks match. It also records unchanged original 0.55.20 and 0.55.60 image
identities, four unchanged earlier manifest hashes, zero owned source
containers and exactly one build command across both preparations.
Local qualification `d25b6155` and origin qualification `f6f03a52` remain
unchanged; all 90 local branches and ten stashes are preserved.

### Validation, limits and pending decision

All 31 focused builder/privacy tests passed, including seven builder tests
and the actual extracted source with zero skips. Two changed code files passed
native syntax and scoped ESLint using the existing engine; no dependency was
installed. After the optional image-field correction, eight builder tests
again passed with zero skips, plus fresh syntax/scoped lint. The 24 unchanged
privacy tests retain their earlier GREEN result, not an invented new run.

| Exact validation command | Result and retained output |
|---|---|
| `node --test scripts\test\membership-privacy-reference.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-privacy-functional.test.cjs scripts\test\membership-statements.test.cjs` with `DERIVED_REFERENCE_SOURCE=test-results\derived-reference-20261023\source` | 31 passed / zero skipped, `green-consolidated.log` |
| `node --test scripts\test\membership-privacy-reference.test.cjs` with the same source setting | Eight passed / zero skipped after correction, `green-optional-image-config.log` |
| `node --check scripts\performance\build-membership-privacy-reference.cjs` and `node --check scripts\test\membership-privacy-reference.test.cjs` | Both passed after correction |
| `node test-results\derived-reference-20261023\validate.cjs` using the existing ESLint engine with seven explicit correctness rules | Two files, zero errors; `static.json` and `static-correction.json`. This is the retained invocation, not permission to overwrite its exclusive output or rerun; scoped correctness lint, not the unavailable normal configuration's full gate. |
| Sole offline build command above | Exit 0 / DERIVED_BUILD_VERIFIED; `offline-build-command.log` |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | Passed, 27 documents; `freshness-sourcebuild-content.log`. Content-only, not the full coupled gate. |
| `git diff --check` | Passed. Whitespace check only; not runtime or admission qualification. |

Source was first committed as `c26768ba`; the optional-field correction is
committed as `b7fdb9c6` before the one actual build. The first failed preflight
is preserved verbatim, not overwritten or described as a build failure.

**Pending explicit decision:** whether this separately identified derivative
may become a prospective diagnostic reference. Neither this build nor the
unavailable user's earlier design choice grants that approval. Runtime
privacy, functional behavior and performance have not been measured on it.
Removing startup logging changes startup work and may affect initial process
history, so request-path byte preservation is not proof of performance
equivalence. Source maps remain original, and file timestamps are excluded
from distribution comparison. The original 0.55.20 image and receipts, negative
0.55.58 admission result, unchanged 0.55.60 candidate, PR #251 and all remaining
release/deployment holds retain their prior meaning.

RCA covers retained commands and failures DR-01 through DR-03 from this
source/build activity. A full earlier-session transcript is not available
through `VSCODE_TARGET_SESSION_LOG`; no full-history reconciliation is claimed.
OS-17 remains separate. No runtime probe, SQL request, performance campaign,
workflow, push, PR mutation, cloud change or deployment was performed.

## Attempt 2 closeout: credential source located, strict result INVALID

**The sole conditional reproduction localized the new privacy rejection to
application-container console output and the PostgreSQL administrative
password role.** It did not fail the four correlated Group authorization
checks: all four had exact masks. No further reproduction or performance
experiment was run or is authorized by this result.

| Observed fact | Result |
|---|---|
| Executed source commit | `fe63bd8df8e4d32036a3233078f8c59ccf184315` |
| Frozen manifest SHA-256 | `8e53459fcf7090725243698ba2f1f79df41f0901f88cd0bb357ba8316aacdc11` |
| Run identity | `950e3bc2253f49e483e51b4e377a2a42` |
| Start / total elapsed | 2026-10-23T20:33:53.939Z / 224.078 seconds, within the five-minute cap including cleanup |
| Actual application | Exact cached 0.55.20 baseline, 0.5 CPU and 1 GiB |
| Persistence policy | Actual server setting `"false"` and stored endpoint setting false; preset setting absent |
| Requests | Seven authenticated functional requests and 13 separate readiness probes, below their respective caps |
| Correlated Group rows | Four expected method/route/status/request-ID/endpoint matches; all `authorization-redacted` |
| Privacy rejection | `generated-credential-detected`, source `app-console`, kind `postgres-admin-password` |
| Other scanned inputs | No generated-credential match in selected rows, PostgreSQL console or Docker tool console |
| Outcome | **INVALID**, not privacy success, admission or release PASS |
| Cleanup | Both exact owned containers and their network removed; post-removal inventory empty |
| Final capture limitation | Application metadata capture failed before removal. Ownership-checked removal and independent absence verification succeeded. Its underlying capture error code was not retained. |

The preregistered source review and hypothesis are retained in
`test-results/os07-functional-20261023/source-review-2.json`. The immutable
attempt lives under `test-results/os07-functional-20261023/attempt2/`, with
`manifest.json`, `report.json`, six frozen executed inputs,
`source-byte-proof.json`, `source-attribution.json` and `held-proof.json`.
No raw private console, credential value, matching substring, context,
credential hash or credential length was exported.

### What the source evidence explains, and what it does not

Release-associated 0.55.20 source at
`6785200ff59ccbc12f62b795439fb245e1635480` contains a Prisma startup message
that interpolates the configured database connection string. The exact
copied compiled legacy logger sanitizes structured data but appends the
message string directly to console output. Together, these facts are strongly
consistent with the observed application-console administrative-password
category. Existing fix `5896771677e3a67308160d2853c69349ad4188c3`
removed that successful-startup emitter and made fallback diagnostics static.
That fix is an ancestor of current 0.55.60 source.

**Attribution limit at the attempt-2 closeout:** the exact compiled legacy Prisma startup file was not
in the retained source copy, the image metadata lacks a valid source-revision
label, and the matching raw console line was deliberately not retained.
Therefore this is not proof of a unique emitted line in the exact historical
image from those attempt-2 artifacts alone. The subsequent unstarted extraction
above now confirms the exact image contains the known emitter, but still does
not reconstruct attempt 1's destroyed match or identify the
destroyed OS-07 row. The newly established result is the safe source/kind
category in attempt 2.

Current repository Prisma source matches 0.55.60 master and does not contain
the known emitter. Its existing 13-test unit suite passes. That is source and
unit evidence, not another runtime privacy qualification of the current image.
The immutable baseline cannot be historically patched, and strict privacy
checks remain unchanged. A future timing comparison is blocked pending a
separately authorized, independently justified privacy-compatible baseline.

### Final validation and preservation

| Exact command or check | Actual result |
|---|---|
| `node --test scripts\test\membership-statements.test.cjs scripts\test\membership-privacy.test.cjs scripts\test\membership-privacy-functional.test.cjs` | 23 passed before execution; 24 passed after the additional fallback regression below |
| `node --test --test-name-pattern='deadline or first failure\|finalization attempts\|admission rejects' scripts\test\membership-history.test.cjs` | Three unchanged targeted tests passed before execution |
| `node test-results\os07-functional-20261023\validate-attempt2.cjs` | Seven source/test files passed syntax and scoped ESLint before execution; this exclusive-output artifact was not overwritten |
| `node test-results\os07-functional-20261023\validate-closeout.cjs` | Two post-run files passed syntax and scoped ESLint, zero errors; retained in `static-closeout-final.json` |
| `node scripts\performance\run-membership-privacy-functional.cjs --functional-only test-results\os07-functional-20261023\attempt2` | Sole execution, exit 1 / INVALID with safe source/kind retained |
| `npm --prefix api test -- --runInBand --runTestsByPath src/modules/prisma/prisma.service.spec.ts` | One suite, 13 tests passed; no new current-image runtime |
| Four earlier manifest hashes | Phase 1, observer smoke, phase 2 and attempt 1 matched their previously retained hashes |
| Available older frozen-input proof | All nine phase-two and five attempt-one `sourceHashes` entries matched their frozen files |
| Six attempt-two frozen inputs | All matched manifest hashes. Raw Git bytes differ; all match after CRLF-to-LF normalization. Frozen on-disk bytes are authoritative. |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | 27 documents passed content-only checks; `freshness-closeout-content.log`, not a full coupled gate |
| `git diff --check` | Passed; whitespace evidence only, not runtime or admission evidence |

After the run, an additional real bounded-child negative test exposed a
fallback-receipt defect: the minimal writer copied unchecked family/run,
cleanup and inventory fields from the rejected report. A private value there
could reject the fallback too and prevent the safe receipt from being written.
The correction uses a fixed family, projects only the proven cleanup boolean,
and records nonempty inventories as `unverified` instead of copying strings.
RED was actual child exit 1 versus expected 0; all 24 focused tests are GREEN
after the fix. This correction is **tested but not used in attempt 2**;
`fe63bd8d` and all six executed frozen files remain unchanged.

Retained validation logs are under
`test-results/os07-functional-20261023/`, including
`red-recursive-receipt.log`, `green-recursive-receipt.log`,
`regression-owned-finalization.log`, `static-attempt2-final.json`,
`functional-attempt2.log` and `current-prisma-source-regression.log`.
Documentation freshness checks using `-SkipCoupling` are content-only
checks, not evidence that the full source-coupled freshness gate passed.

RCA completeness is reconciled against retained command outputs and the
current activity's actual failures. `VSCODE_TARGET_SESSION_LOG` is unavailable,
so a full prior-session transcript reconciliation cannot be claimed.
Destroyed private evidence was not reconstructed. No push, PR #251 mutation,
remote CI, cloud operation, new image installation or deployment occurred.
Original 0.55.58 negative admission evidence and all customer, migration,
capacity, operational, cleanup-403 and visual holds remain unchanged.

## Source-only policy review before attempt 2

**The frozen phase-two fixture did not request masking.** It omitted both
the server persistence environment variable and an endpoint persistence
override. The exact cached 0.55.20 image has no image-level override, and its
copied `rfc-standard` preset omits `PersistRequestSecrets`. Exact compiled
source therefore predicts the legacy default, true. Requiring a mask without
explicitly disabling persistence was an unjustified fixture assumption.
Confidence in that source-level contract conflict is high; the destroyed
runtime settings, cache and individual OS-07 row are still unknown.

| Input or state | Frozen phase two | First new functional fixture |
|---|---|---|
| Launcher `PERSIST_REQUEST_SECRETS` | Not passed | Explicit false, independently observed false |
| Cached image environment override | Absent | Same exact baseline image |
| Requested endpoint preset | `rfc-standard` | `rfc-standard` |
| Exact copied preset persistence setting | Absent | Observed absent before explicit update |
| Explicit endpoint persistence update | None | False, independently read from owned database |
| Effective setting of the destroyed old row | Not retained | Not reconstructed from the new fixture |

This does not establish that the old mismatch was a raw generated
authorization header: the frozen validator's generated-credential check
preceded its mask assertion and did not fail there. A raw generated credential
would have failed that earlier check. The old SQL also lacked endpoint and
request-ID correlation. Policy inheritance explains why the asserted contract
was unsupported, not which destroyed row or value caused OS-07.

The separate OS-11 failure from functional attempt 1 remains a different
question. That fixture sent credentials only through its authorization
header, selected four correlated Group records, observed four exact masks,
and then rejected a generated-credential match somewhere in its selected rows
or combined console input. The selected nonheader fields derive from owned
identifiers, static routes/methods and statuses; no body was selected.
Application-container startup runs Prisma migrations before the application.
Its migration stdout is suppressed but stderr is not. The logging sanitizer
redacts sensitive object keys; a string containing a credential is not
necessarily redacted by that key-based mechanism. These are possible paths,
not an identified emitter.

The new discriminating hypothesis is that startup/migration or other
container output, rather than a Group authorization field, supplied OS-11.
The implementation separately scans selected rows, application-container
records, PostgreSQL-container records and Docker tool output. Docker
`--timestamps` prefixes distinguish container records from unframed tool
diagnostics; they do not identify a particular application statement.
PostgreSQL administrative output and tool diagnostics must not be mislabeled
as application defects. No raw stream or matching context is persisted.

### Executable information-preservation safeguard

`membership-privacy.cjs` now constructs every rejection in this diagnostic
privacy family through a closed schema: static reason, input source,
credential kind, and row index when applicable. Credential roles are declared
by the real callers, not inferred from values. All matching source/role
combinations are retained, rather than only the first. Missing inputs,
invalid roles, serialization failures, malformed headers, missing masks,
provenance failures and report-output rejection keep the same safe contract.
Unknown metadata is rejected using a fixed safe category, never echoed.

The report writer rejects private output before writing and preserves a
minimal INVALID receipt with safe cause/source/kind and cleanup facts. An
actual bounded Node child verifies that path. Tests also reject added
private-value, credential-hash, length or context fields in failure metadata.
A static regression selector prevents bare canary assertions from returning
to the active statement helper and both current diagnostic runners.
The original admission/default path and all frozen input directories remain
unchanged; this is prospective diagnostic tooling only.

Before any conditional attempt, 23 focused tests and three unchanged
deadline/finalization/admission selectors passed. Seven changed code files
passed native syntax and scoped ESLint correctness rules with zero errors.
This is not a repeated performance campaign.

### Execution issues and immediate prevention

| Issue | Type / severity | Confirmed cause and fix | Detection and earliest applicable check |
|---|---|---|---|
| OS-13 | Diagnostic evidence / High | The previous correction retained a row/console location but lost credential role; input and output assertions could bypass metadata entirely. One typed, allowlisted failure seam now covers real callers, all private inputs and final receipt writing. No secret-derived identifier or context is exported. | Focused RED observed missing `source`; complete input/output negative tests and bounded-child GREEN now prevent recurrence. |
| OS-14 | Test/tooling / Low | An insertion matched an inner closing brace. The first name-filtered command executed no matching subtest and reported only a file-level success. A full small selector exposed the missing metadata. A later misplaced helper declaration failed module loading. Both were corrected using full function boundaries. | Whole-file selectors and `no-undef` catch these before execution; file-level success is not evidence that a named test ran. |
| OS-15 | Static correctness / Low | A newly added throw inside `finally` violated `no-unsafe-finally`. The minimal-receipt writer was extracted into a small cohesive function, then proved in an actual bounded child. | Scoped ESLint caught it before any fixture; zero errors after the correction. |
| OS-16 | Legacy privacy evidence / High | Attempt 2 proves an application-console match for the PostgreSQL administrative password role, while all four selected authorization fields are masked. A release-associated raw database-URL startup emitter is strongly consistent and was already removed in current source by `58967716`; exact emitted-line attribution remains unproven. The immutable baseline stays INVALID. | Complete static source/kind telemetry caught the new category during bounded functional proof. Existing current Prisma tests pass; no privacy waiver or historical image modification. |
| OS-17 | Cleanup observability / Medium | Final application metadata capture failed; the existing finalizer retained only a boolean, so the original error code is unknown. Exact owned removal and independent absence checks succeeded. Final captures must not be described as uniformly successful. | Finalization receipt caught the capture failure, but an earlier safe error-category retention check could have preserved its cause. Follow-up owner: diagnostic maintainer; target 2026-10-24, separately authorized source-only cleanup-telemetry hardening. No retry in this scope. |
| OS-18 | Diagnostic receipt / High | A post-run negative child proved unchecked cleanup/inventory/family fields could trigger a second rejection in the fallback itself. The fallback now projects a fixed schema with no unchecked strings. This correction was not used in attempt 2. | Actual child RED (`1 !== 0`) before correction; focused GREEN 24/24 afterward. This closes the newly found receipt-loss route without weakening privacy. |

The source-only facts and exact command evidence are retained under
`test-results/os07-functional-20261023/`: `source-review-2.json`,
`red-source-kind-full.log`, `red-complete-functional-telemetry.log`,
`red-final-receipt-and-null-row.log`, `green-attempt2-ready.log`,
`regression-owned-finalization.log`, and `static-attempt2-final.json`.
No new container was created for the source-only review.

Self-improvement: **applied** the closed failure schema, branch-matrix negative
tests, static bare-assertion check and real-child minimal receipt proof.
Design/architecture disposition: **applied** one small shared privacy seam
for two real diagnostic callers; default/admission behavior and historical
application images are not generalized or changed. No new framework is needed.

## OS-07 first bounded functional follow-up

**Outcome: INVALID and inconclusive for OS-07.** The single functional run
completed seven authenticated requests and verified cleanup in 182.033 seconds.
All four known authorized Group rows had object-shaped serialized headers with
the exact mask. However, generated-credential absence failed on private input.
No retry ran. This neither reproduces the old mask mismatch nor establishes
an application defect; no original private evidence has been reconstructed.

Exact cached 0.55.20 source confirms that `resolvePersistSecrets` inherits
`PERSIST_REQUEST_SECRETS`, defaulting to true, unless endpoint settings override
it. The interceptor copies request headers, the exception filter uses captured
headers or a request-header fallback, and `stringifyValue` serializes stored
headers with `JSON.stringify`. None identifies the destroyed OS-07 row.
The executed phase-two SQL selected the latest 200 Group PATCH/error rows
without correlating their request IDs to the workload.

The single functional fixture explicitly disabled server and endpoint secret
persistence. Seven generated-authenticated requests were preregistered:
endpoint creation and policy update, Group creation and update, missing-Group
GET and PATCH, and one flush. Four exact authorized Group rows must match
endpoint, request ID, method, route and expected status. Omission, duplicates,
foreign rows and missing masks fail. Readiness is counted separately.
The cap is five minutes including a two-minute cleanup reservation, with a
ten-second bounded SQL flush wait. There are no timing cycles.

The shared privacy validator accepts an explicit required count for this
four-row proof. Its existing default remains exactly 200 and every selected
row still requires the exact `[REDACTED]` authorization value.
Generated-credential absence is checked privately in rows and both console
streams. No raw header value, connection string, payload or credential is
written.

Before execution, 13 focused tests passed, including actual bounded child
default rejection, admission rejection, privacy negative canaries, exact
provenance/count rejection and successful empty flush responses. Four files
passed native syntax and scoped ESLint correctness checks. RED evidence and
the frozen manifest belong under
`test-results/os07-functional-20261023/`, separate from all previous runs.

### Actual functional observations and their limits

Run `03050f4d33d740a398deff7d0eb419ba` started at
`2026-10-23T20:05:01.542Z` from committed source
`ec745e7a387bcb2b969bcfa3ba7bc264ed076aa5`.
The exact cached baseline digest ends `8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a`;
the exact cached PG17.11 digest ends
`2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3`.
Requested digests and actual platform image IDs matched.
The application reported 0.55.20 and `PERSIST_REQUEST_SECRETS=false`;
the endpoint's stored setting was independently read as false.
The unmodified `rfc-standard` preset had no value for this setting in the
new fixture. That absence is not proof of the old run's effective policy.
Actual application limits were 0.5 CPU and 1 GiB, with no observed OOM flag.

| Known authorized route | Method | Observed status | Endpoint/request/method/route/status proof | Header classification | Old SQL predicate |
|---|---|---:|---|---|---|
| Group creation | POST | 201 | Matched | Authorization present, exact mask | Excluded |
| Existing Group update | PATCH | 200 | Matched | Authorization present, exact mask | Included |
| Missing Group read | GET | 404 | Matched | Authorization present, exact mask | Included |
| Missing Group update | PATCH | 404 | Matched | Authorization present, exact mask | Included |

The other authenticated requests were endpoint creation (201), endpoint
policy update (200), and flush (204). Fifteen unauthenticated health readiness
attempts were recorded separately. They were not eligible for the selected
four-row cohort. Three of these four rows satisfy the old Group PATCH/error
SQL predicate. This proves that particular new cohort's provenance and mask
shape, not the provenance of the old 200 rows.

The strict privacy check then rejected a generated credential match in either
the private selected rows or combined application console streams. Its executed
failure classification did not retain which input matched. The header
classifications do not prove that other private fields or console output were
safe. No raw value was saved, and neither source nor credential kind can now be
recovered from this receipt. **There is no overall privacy PASS.**

Both owned application/database containers and their network were removed.
Capture, removal and post-removal verification succeeded for each container;
the final run-label container and network inventories were empty.
The two unstarted source-inspection containers were also removed.
The three pre-existing shared containers were untouched.

The manifest hash is
`6ca5d02cc4875a4935e5eecbb527b3910375e41fd5380bc72e3372242645d52e`.
All five frozen inputs match their manifest hashes. None matches its Git blob
byte-for-byte; all five match after CRLF-to-LF normalization.
The frozen on-disk bytes, not a reconstructed Git checkout, identify this run.
`attempt1/source-byte-proof.json` records both comparisons.

### Validation and retained evidence

| Exact command | Result |
|---|---|
| `node --test --test-name-pattern='small functional privacy sample' scripts\test\membership-statements.test.cjs` | Confirmed RED on exact row count, after correcting test discovery |
| `node --test scripts\test\membership-privacy-functional.test.cjs` | Confirmed RED on accepting duplicate/foreign rows; later GREEN |
| `node --test --test-name-pattern='legacy flush' scripts\test\membership-privacy-functional.test.cjs` | RED on absent successful-empty decoder; later GREEN |
| `node --test scripts\test\membership-statements.test.cjs scripts\test\membership-privacy-functional.test.cjs` | 13 tests GREEN before execution; 14 GREEN after the unmeasured metadata correction |
| `node scripts\performance\run-membership-privacy-functional.cjs --functional-only test-results\os07-functional-20261023\attempt1` | INVALID, exit 1; seven authenticated requests, no replacement, cleanup verified |
| `node --test --test-name-pattern='generated-credential rejection retains' scripts\test\membership-statements.test.cjs` | Post-run RED on missing row-versus-console provenance; later GREEN |
| `node test-results\os07-functional-20261023\validate-final.cjs` | Four files passed native `node --check` and scoped ESLint correctness rules; zero lint errors |
| `pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling` | 27 manifest documents passed content-only currency/link checks; source coupling was explicitly skipped, so this is not the full coupled gate |
| `git diff --check` | Passed |

The evidence directory holds separate RED/GREEN logs, frozen inputs,
`functional-run.log`, the manifest, and the privacy-safe `report.json`.
No phase-one/phase-two receipt, raw sample or executed source was changed.
The diagnostic document remains indexed in `docs/INDEX.md`. The freshness
result above covers the manifest's 27 documents, not an invented full-project
documentation gate.

Execution issues confirmed during preparation:

- **OS-09, source inspection / Low:** an assumed controller filename was absent
  from the cached image. The unstarted source container was still removed.
  Already copied exact logging/filter/config/DTO source supplies the relevant
  contract; no historical application was modified. Oversized tool output was
  reissued as bounded original-source reads; automatically generated temporary
  output files were never opened. A mismatched document-heading patch was
  corrected after reading the actual heading. These were preparation-time
  tooling failures, with no runtime escape or waived result.
- **OS-10, test selection / Medium:** an initially nested test was not selected
  by its standalone name, producing only a file-level green result. Moving it
  to top level exposed the expected row-count assertion RED. Named assertion
  evidence, not a file-only green, is required. The subsequent 13-test run
  includes the actual named regression.
- **OS-11, functional privacy rejection / unresolved severity:** all four
  selected authorization fields had the mask, but the broader canary check
  rejected private input. The underlying mechanism is unresolved, not an
  established application defect. Resolution: retain INVALID and stop. The
  functional privacy check was the first applicable runtime detector.
- **OS-12, failure provenance / Medium:** the executed canary classifier
  intentionally suppressed values but also omitted whether rows or console
  matched. That omission was detected when reviewing this stopped run; the
  earliest possible detector was a negative-canary unit test before execution.
  A focused assertion first failed, then passed after retaining only static
  `rows`/`console` locations. This correction is tested but unmeasured. It does
  not add missing facts to `attempt1/report.json`.

This follow-up ledger is reconciled against the retained source-inspection,
RED/GREEN, static-check and single functional-run records available for this
turn. It does not claim reconciliation against a full historical session
transcript, and it does not reconstruct any discarded private input.

Self-improvement is **applied** through exact known-request provenance and
negative canaries. The design disposition is **accepted**: one cohesive,
opt-in functional fixture reuses the existing client, strict privacy classifier
and cleanup finalizer. No new framework or speculative abstraction is needed.

### Remaining work is blocked on a new bounded authorization

OS-07 remains unresolved. Before any further runtime diagnosis, explicitly
authorize a new functional scope that uses the tested canary-location metadata.
If it identifies console input, inspect the exact legacy startup/logging source;
if it identifies rows, inspect only safe request provenance and structural
fields privately. Do not relax the mask or generated-secret checks. No new
performance experiment, admission retry or deployment is authorized by this
result. All earlier publication, customer-data, operational and release holds
remain unchanged.

## Executive summary

The previous boundary collector paused the workload for 12.981-24.731 seconds
per observation because it launched two serial Docker CLI commands. That is a
measurement-system defect, not application latency. The replacement starts one
owned read-only observer channel and uses bounded JSON-lines requests after
startup. No prior receipt is relabeled as using this corrected collector.

The fixed observer-only smoke has passed. SQL capability and privacy checks on
a separate disposable cached-PG fixture also passed. The single subsequent
eight-round statement attempt is **INVALID after four complete BAAB rounds**:
an exact legacy header-redaction assertion failed after the block. All owned
resources were removed. No ABBA or replacement run was attempted. No additional
16-round history experiment, remote publication, deployment or release
admission is authorized.

## Request and identity flow

```text
Owned app creation -> inspect exact owner, image, PID and resource configuration
                  -> bind PID/container to actual Linux process-start epoch
Host boundary     -> one outstanding framed pipe request
Owned observer    -> read actual process, cgroup, quota, memory and CPU counters
                  -> recheck process-start and cgroup after reading
Host boundary     <- bounded matching request ID and snapshot
Intentional restart -> old binding must fail -> explicit new PID/epoch binding
```

Only intentional creation or restart needs Docker inspection. Every snapshot
still checks actual Linux process identity and resource policy, so cached
metadata cannot turn a restarted process into a successful old-epoch read.
Unknown owners, targets, request IDs, duplicate frames, missing fields,
oversized frames, unexpected stderr, EOF and timeouts fail closed. Expected
restart detection quarantines that target until an explicit refresh; other
protocol failures terminate the channel. Raw failed frames and stderr are
withheld rather than logged.

## Frozen smoke policy

| Item | Fixed value |
|---|---|
| Snapshots | 32 successful reads, 16 before and 16 after one intentional restart |
| Extra reads | Two explicit bindings and one expected old-epoch rejection, reported separately |
| Host round-trip limits | Median <= 250 ms, nearest-rank p95 <= 1,000 ms |
| Total cap | 180 seconds including startup and cleanup; reserve 60 seconds for cleanup |
| Target | Owned idle Node fixture in cached immutable 0.55.60 image |
| Resources | 0.5 CPU, 1 GiB, 100 ms CPU period, zero burst, original 384 MiB RSS ceiling |
| Observation | One persistent Docker exec channel, host PID/cgroup visibility, read-only mounts |
| Workload requests | None |

All durations and Linux read windows must be retained. A threshold failure,
partial result or cleanup failure is INVALID, not permission to repeat until
fast. The phase-one frozen manifest and raw arrays remain untouched.

## Focused validation and execution ledger

The initial protocol/privacy tests failed before implementation (`red.log`).
The intentional-refresh test separately failed before its correction
(`red-restart.log`). The combined observer/history suite then passed all
19 tests (`green-final.log`), including actual bounded subprocesses, capture-failure
cleanup and the normal workload child path. Syntax checks passed.
Seven unchanged admission selectors passed. Scoped existing-engine ESLint
reported zero errors. A third RED/privacy control proved that missing counter
fields or private extra fields could not be accepted after the snapshot
allowlist correction (`red-snapshot-privacy.log`).

Evidence is under `test-results/observer-stream-20261023/`.
The smoke outcome below comes from its actual immutable receipt, not unit tests.

### Actual observer-only result

The single smoke is **OBSERVER-SMOKE-COMPLETE**: 32/32 snapshots,
median **3.5414 ms**, nearest-rank p95 **4.9941 ms**, startup binding
7,820.2621 ms, and total elapsed including cleanup **110,587 ms**.
The expected old-process read was rejected after one intentional restart;
the same observer stream accepted the explicit new PID/start-time binding.
Both owned containers were removed and the final owner-filtered inventory
was empty. No workload requests were issued.

The frozen manifest SHA-256 is
`fc88251b0d7a9455074b41ca562c308102c843ce7e53290dee4df94b8c387831`;
its source tip is `c732737b45001567ae8e69f71bd4fbf02df700c5`.
All 32 host durations, underlying Linux read windows, both bindings, actual
resource configuration and restart metadata are in `smoke/report.json`.
Startup and the expected restart-rejection probe are separate from the
32-sample latency distribution. This fixes the observed boundary-launch
defect in this owned idle-fixture test; it is not request-latency admission.

The cached PostgreSQL capability probe also succeeded without installation:
PostgreSQL 17.11 contains `pg_stat_statements.so`, SHA-256
`d312f84eb42f20c46022c94f69842615b974ac6ac88d4bf5b43ac6d125473258`.
The disposable read-only probe container was removed. Its receipt is
`pg-capability-probe.json`.

### Statement implementation and real SQL capability check

The real SQL probe passed once in **43,688 ms including verified cleanup**,
run `faa8335989c446aea9b9b83de5804bd3`. It enabled only the already-present
extension on its own disposable PostgreSQL 17.11 fixture. PostgreSQL's builtin
SHA-256 matched the host's known value. A persistent existing `pg` client
verified exact database/application-user scope, a two-call/two-row delta,
new-entry handling, string query IDs, separately counted observer calls and
private-canary exclusion. No application workload or shared reset occurred.
Evidence: `test-results/membership-statements-20261023/pg-sql-probe.log`.

The new explicit-opt-in runner fixes A to immutable 0.55.20 and B to immutable
0.55.60. Its frozen schedule is BAAB then ABBA once, with two reused role apps per
block and new equivalent role databases. It retains 100 warmup and 1,000
measured complete four-operation cycles per round, 4,407 checked workload
requests per round, 0.5 CPU/1 GiB apps, 384 MiB RSS ceiling, 100 ms CPU period,
zero burst and the existing ancestor policy. The cap is 45 minutes with a
90-second cleanup reservation. There is no favorable retry or replacement.

```text
Existing workload child -> boundary IPC -> persistent Linux observer
                                     -> persistent native PostgreSQL client
PostgreSQL application-user statistics -> in-database whitespace normalization
                                      -> in-database SHA-256 fingerprint
                                      -> allowlisted numeric/identity receipt
Raw SQL, parameters and credentials stay out of exported receipts
```

This is a new prospective PostgreSQL configuration: preloaded
`pg_stat_statements`, `compute_query_id=on`, tracking `all`, separate identical
non-superuser application roles/database owners and a read-only statistics
observer granted `pg_read_all_stats`. It is not attributed to earlier runs.
No extension package, dependency or image was installed.

Each warmup/measured window retains both boundary snapshots, actual capture
timestamps and host read durations, CPU/process epochs, statement fingerprints,
opaque query ID strings, top-level/nested identities, calls, execution
milliseconds, rows and all available PG17 block/temp/WAL counters. Reset,
eviction, missing entry, counter decrease or epoch change invalidates the
window. A new entry starts at zero only with proven no reset/eviction.
Window mean is execution delta divided by call delta. Zero-call means are null.
Observer-user calls/execution are separate from application-user statistics.
Static table-reference labels and unresolved/mixed buckets are descriptive,
not proof of code ownership or commit causation.

The original checked workload is unchanged. The legacy receipt version is
explicitly 0.55.20 only in this runner; the helper default remains 0.55.60.
Current-only 66-outcome contract assertions run only against B after each block.
Private header-log checks run after the windows; raw logs/payloads are not
persisted. No current-only error-correlation requirement is imposed on A.

Focused validation now passes **27 tests**, including real child framing,
duplicate replies, normal-default non-dispatch, an exact admission-rejection
reason, legacy receipt selection and SQL privacy/reset/mix guards. Seven
unchanged admission selectors and scoped existing-engine ESLint also pass.
The real SQL probe is one additional integration test, not an eight-round run.
Frozen runtime source bytes, resolved platform IDs, application distribution
hashes, 33 loaded PostgreSQL-client module hashes and the final manifest
identify the execution. Git's CRLF normalization does not redefine those
on-disk hashes.

## Actual phase-two attempt: INVALID, four rounds retained

The source was committed before execution as
`f6731ffb1f94f92e1c6b3d4c364b204d2fb179ce`. The single attempt was
`c00c5c2d419a4ce4870446aa670853ac`, starting at 19:20:07.645 UTC and
finishing, including cleanup, after **532,487 ms (8.875 minutes)**.
Its manifest was frozen at 19:22:22.838 UTC, before the workload, with SHA-256
`ef712837359d4149d6e85d6cb89c9c1c071880ed66d48f4f9b7816e529041d0a`.
The host client was Node v24.13.0 with existing `pg` 8.22.0; PostgreSQL was
17.11 with statement extension 1.11. Actual settings are in the manifest.

Four BAAB visits completed all original assertions: **17,628 checked requests,
16,000 measured timings and 1,600 warmup timings**. Eight CPU/statement windows
and all 16 corresponding boundary snapshots are retained. The current-only
runtime contract completed 66 outcomes. Neither role's post-block privacy
receipt completed: A was checked first and failed its exact authorization-mask
assertion. The subsequent B privacy check and the entire ABBA block did not
run. This is not a completed comparison or release acceptance.

### Failure and exact boundary of knowledge

The first causal frame is frozen runner line 339, in the legacy loop requiring
`JSON.parse(row.requestHeaders).authorization === '[REDACTED]'`.
The 200-row count and generated-secret absence checks preceding that assertion
completed. The retained error is `ERR_ASSERTION` at stage `contract-baab`;
the privacy-safe handler withheld actual header values, but also failed to
retain whether the field was missing or had a different non-secret value.

Two unstarted, explicitly owned source-only containers were used afterward to
read the exact cached baseline's compiled logging/redaction code, then removed.
That source uses the **same** `[REDACTED]` sentinel and captures request headers.
It does not justify blaming an alternative legacy sentinel or relaxing the
assertion. The exact differing private value and underlying application cause
cannot be reconstructed after required cleanup. They remain **unresolved**.
No raw headers, SQL text, parameters, payloads or credentials were saved to
answer that question retrospectively.

A subsequent test-first source correction preserves the strict requirement
and emits only safe categories for absent authorization, mask mismatch,
unparseable headers or a generated-credential detection. All **28 focused
tests** pass, including negative private-value canaries. This correction is
**tested but unmeasured**: it did not produce, rewrite or validate the four
frozen receipts, and no experiment was repeated.

### Descriptive measured-window observations, not accepted evidence

Each row below covers 1,000 complete four-operation cycles. CPU is application
cgroup CPU-use delta per cycle, not PostgreSQL execution time. Statement
execution sums include nested statements and are not non-overlapping database
wall time.

| Visit / release | Statement calls | Statement execution sum (ms) | Rows | App CPU ms/cycle | Add p99 (ms) | Remove p99 (ms) |
|---|---:|---:|---:|---:|---:|---:|
| B1 / 0.55.60 | 25,243 | 1,357.025 | 23,003 | 25.888 | 95.422 | 97.051 |
| A2 / 0.55.20 | 26,243 | 858.202 | 20,003 | 28.241 | 98.945 | 89.271 |
| A3 / 0.55.20 | 26,240 | 885.784 | 20,000 | 24.939 | 84.214 | 89.657 |
| B4 / 0.55.60 | 25,243 | 1,180.598 | 23,003 | 22.650 | 84.631 | 99.763 |

Warmup CPU-use per cycle was respectively 36.688, 49.478, 29.277 and
29.266 ms; its statement execution sums were 134.133, 101.844, 91.491 and
120.821 ms. These are separate windows, not subtracted across process epochs.
All operation p50/p95/p99 values remain in each round summary; no tails were
dropped.

Across the two retained visits per role, B recorded **3.805% fewer calls**
(50,486 versus 52,483), **45.507% greater summed statement execution**
(2,537.623 versus 1,743.986 ms), and 46,006 versus 40,003 rows.
Top-level execution sums were 2,509.290 versus 1,709.100 ms; nested sums were
28.333 versus 34.887 ms, with 4,000 nested calls in each role.
These totals describe the retained BAAB block only.

The following table combines the two measured visits within each role.
Fingerprint prefixes identify full hashes in the exported tables. Distinct
fingerprints are not assumed to be equivalent SQL, even when labels match.

| Role | Fingerprint prefix | Proven static reference / operation | Calls | Execution sum (ms) | Rows |
|---|---|---|---:|---:|---:|
| A | `1287f7333f07` | RequestLog / insert | 160 | 635.263 | 8,000 |
| B | `871c0a0b86c9` | RequestLog / insert | 160 | 1,056.233 | 8,000 |
| A | `893e9aa443db` | ScimResource / select | 12,000 | 331.591 | 12,000 |
| A | `01629902672b` | ResourceMember / insert | 2,000 | 253.382 | 2,000 |
| B | `66ef960f4507` | ResourceMember / unresolved operation | 2,000 | 291.197 | 2,000 |
| B | `dd988e886af7` | Mixed ResourceMember/ScimResource references / select | 8,000 | 462.567 | 8,000 |
| B | `848a6f179312` | Mixed ResourceMember/ScimResource references / select | 4,000 | 227.067 | 4,000 |
| A | `666edf15fe19` | ScimResource / update | 4,000 | 178.931 | 4,000 |
| B | `8d070fa04d58` | ScimResource / update | 4,000 | 174.588 | 4,000 |

The RequestLog insert families alone account for **53.04% of the aggregate
execution-sum difference**, despite equal 160 calls and 8,000 rows. Their
window-derived execution means are 3.970 versus 6.601 ms per call. B's family
recorded 239,490 versus 192,527 shared-buffer hits and 43,233,469 versus
26,248,514 WAL bytes; both recorded zero shared-block reads in these windows.
This points descriptively toward logging insert shape/work and changed query
mix as useful concerns, not a proven code change, payload-size cause, CPU
cause or disk/network-latency cause. WAL is write-ahead-log volume, not a
duration. The fingerprints differ, and raw SQL was intentionally unavailable.

The resource-label mapping is limited to the named repository concerns:
`RequestLog` is persisted request logging, `ResourceMember` is membership
storage, `ScimResource` is resource storage, and mixed/unresolved entries remain
unresolved. No commit or per-request attribution is claimed.

### Observer cost, accounting and limitations

The 16 actual combined CPU-plus-PG boundary reads cost **18.293-35.105 ms**,
median **24.067 ms**, nearest-rank p95 **35.105 ms**. PG host reads cost
14.488-25.327 ms; underlying Linux reads cost 0.663-2.888 ms. Each measured
window separately recorded one observer-user call, with execution-counter
deltas 14.844, 10.069, 9.178 and 10.397 ms. These queries are excluded from
application-user statement statistics. Initialization, readiness, bindings,
canary checks, contracts and private-log reads are separate from the 4,407
workload requests per round.

The two app processes retained their original epochs throughout the BAAB
block. Required counter, reset, eviction, resource and epoch guards passed
for the retained windows. Maximum observed Node high-water RSS was
223.023 MiB, and cgroup memory peak was 289.113 MiB; OOM counters remained zero.
All four owned containers (two apps, PostgreSQL and observer) and the owned
network were verified removed; the stream closed with code zero and final
owner inventory was empty.

This remains a shared Windows/WSL scheduling environment with three unrelated
containers left untouched. Boundary collection still perturbs execution and
quota phase. Buffered logging, background work, database/OS cache history and
unobserved host interference remain. Only one BAAB block exists, not the
planned ABBA contrast; repeated visits to two processes are not independent
replicates. PostgreSQL execution counters are not CPU time or network round
trip, and statement means are not request p99. This compares 0.55.20 with
0.55.60, not the old 0.55.58 incident.

### Reproducible evidence

Everything below is under
`test-results/membership-statements-20261023/`, separate from phase one:

| Evidence | Actual result |
|---|---|
| `phase2/manifest.json`, `preregistered-plan.json`, `frozen-inputs/` | Executed source/configuration identity, immutable raw inputs |
| `phase2/report.json`, `phase2.log` | INVALID, four complete visits, first causal frame and verified cleanup |
| `phase2/baab-*.json`, `*-windows.json`, `*-summary.json` | Original timing arrays, cycle/operation links, all boundary/window records |
| `phase2/baab-current-contract.json` | 66 current contract outcomes complete |
| `phase2/per-round-fingerprints.csv` | 1,090 per-round/per-phase fingerprint rows, including zero-call entries and all block/temp/WAL counters |
| `phase2/analysis.json` | Numeric-only descriptive summaries, full fingerprint/query-ID identity sets and observation costs |
| `phase2/source-byte-proof.json` | All nine frozen hashes match; zero match raw Git bytes, all nine match after CRLF-to-LF normalization |
| `legacy-image-source/` | Exact immutable baseline compiled redaction/logging code and source-only container provenance |
| `red-privacy-cause.log`, `green-postrun-privacy.log` | Post-run safe-cause correction RED/GREEN, 28 focused tests |
| `red-privacy-missingness.log`, `green-privacy-final.log`, `postrun-static-final.json` | Required private sample/canary checks RED/GREEN, nine statement tests rerun, eight syntax/lint files clean |

Primary executed input SHA-256 values:

| Input | Frozen on-disk SHA-256 |
|---|---|
| `run-membership-statements.cjs` | `0e829068762684bf9db4d70344a6c5e730c730e3fb1b2247594f668d60b94237` |
| `membership-statements.cjs` | `4beb5738dcfc9529611933726cd710f437f8f2944527bff3a5a3b1fe07db277d` |
| `membership-statement-fixture.cjs` | `a9a8661d1396c83868bcf71c6c3287ba1fbf1a4fc20fa044764cb2f2b9f2daa9` |

The manifest contains all nine runtime input hashes, the Node executable hash,
33 loaded-client module hashes, app distribution/Prisma hashes, PostgreSQL
library hash and actual platform image IDs. These are the executed identities;
the post-run tested correction is not substituted for them.

### Commands and actual validation results

All commands ran from the exclusive worktree. These are historical execution
records, not authorization to repeat either timed run.

```powershell
node --test `
  scripts\test\membership-observer.test.cjs `
  scripts\test\membership-history.test.cjs `
  scripts\test\membership-statements.test.cjs
```

Result: 27 passed before execution; 28 passed after the additional safe-cause
RED/GREEN correction. The separate RED logs retain the missing implementation,
legacy receipt-version rejection, nesting omission and exact admission-fixture
failure rather than treating an arbitrary exception as the intended guard.

```powershell
$env:SCIM_RUN_OWNED_PG_PROBE = '1'
node --test scripts\test\membership-statements-pg.test.cjs
```

Result: one actual SQL integration test passed once, including cleanup,
43.688 seconds. The environment variable was scoped to that command process.

```powershell
node --test `
  --test-name-pattern='identical samples|tail-only regression|A/A requires|nearest-rank|incomplete, reordered|unknown order|preregistered protocol' `
  scripts\test\membership-performance.test.cjs

node test-results\membership-statements-20261023\validate-source.cjs
pwsh -NoProfile -File scripts\audit-doc-freshness.ps1 -SkipCoupling
git diff --check
```

Results: seven unchanged admission selectors passed; eight CommonJS syntax
checks and eight scoped existing-engine ESLint checks passed with zero errors;
27 documentation freshness checks passed; no whitespace errors. Editor
diagnostics reported no errors in the changed diagnostic source. No dependency
installation, product-version change or full-suite repetition was needed.

```powershell
node scripts\performance\run-membership-statements.cjs `
  --diagnostic-only `
  test-results\membership-statements-20261023\phase2
```

Result: exit 1, INVALID after four complete visits, with exact cleanup as
reported above. The existing output directory and frozen files were preserved.

## Issues, root causes and improvement dispositions

| ID | Type / severity | Observed issue and mechanism | Correction and detection |
|---|---|---|---|
| OS-01 | Measurement architecture / High | Two serial Docker CLI launches dominated boundary cost by seconds. The earlier collector preserved read cost but had no executable low-disturbance gate. | Persistent owned stream plus the single passing real-fixture smoke above. Earliest possible detection: observer-only smoke before workload execution; detection escaped to the phase-one workload report. |
| OS-02 | Lifecycle / Medium | Initial strict protocol treated an intentional process change as an unrecoverable framing failure, preventing an explicit refresh on the same stream. | A narrowly typed epoch-change response quarantines only that binding. Actual-child RED/GREEN proves detection and refresh without silently accepting the old epoch. |
| OS-03 | Diagnostic contract / High | An epoch-only reply check initially accepted missing counters or arbitrary private extra fields from a faulty collector. | RED privacy canaries preceded an exact snapshot-key allowlist and full counter/policy validation on both stream ends. Unknown fields never become persisted receipts. Detection: focused child privacy test; earliest: the same test before encoder implementation. |
| OS-04 | Compatibility / Medium | The history helper intentionally fixed receipt version to 0.55.60, so an explicit 0.55.20 comparison was rejected before useful diagnosis. | Retained legacy-receipt RED followed by an explicit expected-version argument, preserving the existing default. Focused GREEN confirms both selections. Detected at the earliest unit-test stage, before the workload. |
| OS-05 | Test correctness / Medium | A generic admission `throws` check initially succeeded on the wrong role-order assertion, not diagnostic exclusion. | The test now uses actual admission role labels and requires the exact diagnostic-rejection message. Tightened check caught the faulty fixture before execution; focused GREEN confirms the intended guard. |
| OS-06 | Summary correctness / Medium | Grouping by fingerprint alone did not expose mixed top-level/nested identities when their query ID was unchanged. | A specific undefined-versus-expected-array RED preceded explicit retained top-level sets and mix flags. Detected at the earliest unit-test stage, before workload execution. |
| OS-07 | Runtime privacy contract / High, unresolved | Exact authorization-mask validation failed in the legacy private log sample after four completed rounds. Baseline compiled source uses the same expected sentinel; the actual differing value was not retained. | The attempt remains INVALID. No mask allowance, missing-as-success rule, replacement or retry was introduced. Detected by post-block privacy; a correctly scoped earlier app-log contract check could have detected it sooner, but would itself need a separately frozen history policy. |
| OS-08 | Failure evidence / Medium | The catch handler grouped `ERR_ASSERTION` with PG/child errors and suppressed the distinction between missing authorization and a wrong mask. | A dedicated private-value-free classifier retains only static reasons, row index and presence. Actual negative canaries passed RED/GREEN. An additional missing-exception RED closed empty-canary/missing-console acceptance in the proposed helper; all nine statement tests then passed. This is tested but unmeasured and does not reconstruct OS-07's missing private detail. Earliest detection: failure-path unit tests before the workload; actual detection: reviewing the stopped attempt. |

**Self-improvement: applied.** Disturbance is now a separately measured gate,
and privacy canaries exercise real child streams before any new diagnostic.
Negative admission tests require the intended rejection reason, and real
PostgreSQL verifies SQL capability/delta/privacy assumptions before workload.
Safe privacy-failure categories are now regression-tested without exporting
the values they reject. The original failing legacy requirement is preserved.

**Design disposition: accepted.** One concrete channel serves the history
runner and the real smoke. Both reuse the existing collector and epoch/policy
guards. There is no new benchmark framework, dependency or application code.
The statement runner is a bounded orchestration file; SQL/privacy/delta math
and disposable database setup live in separate cohesive helpers. Further
strategy abstractions would have only one implementation and are declined.

**Provenance/completeness:** This ledger was reconciled against available tool
outputs, the retained RED/GREEN logs, both owned probe receipts, the single
workload attempt and its finalization records. The complete subagent JSONL
transcript was not exposed; full-transcript completeness is not claimed.
Read-only source inspection disproved an alternate-redaction-sentinel
explanation. It did not establish the actual missing/wrong header value.

## Unchanged holds

The original negative 0.55.58 admission evidence, phase-one evidence, customer
data, migration, capacity, operational, cleanup-403 and visual holds remain.
Even a successful smoke or statement diagnostic is not release PASS and cannot
retroactively prove the cause of the 0.55.58 incident.
