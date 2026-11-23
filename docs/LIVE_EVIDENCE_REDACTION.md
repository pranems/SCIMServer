# Live integration evidence redaction

**Last verified:** 2026-11-23

## Executive summary

The original redaction correction was merged in #280, and the separate
ownership correction was merged in #281. A source-only evidence-preparation
performance follow-up is now under qualification. It does not change the
application image, package versions, authentication lifetime or assertions.
Authentication and credential material must reach real HTTP requests and
positive administrator assertions, but must not reach console output or the
run-specific and latest evidence JSON files. The historical implementation
evidence below remains useful; the new qualification result is recorded next.

**Shared-estate boundary:** Endpoint ownership is now guarded, but the complete
suite also mutates global settings and logs. Qualify on a separately owned
disposable instance/database rather than assuming endpoint ownership makes
shared dev execution preservation-safe.

## Preparation reuse and live-run expiry

The unchanged complete Windows live run against exact merged `c52de06f`
emitted 633 PASS lines and no assertion FAIL lines, then aborted with
`bearer_oauth_expired` after approximately one hour. Its trap attempted cleanup
with the expired token; 15 cleanup failures were retained. No final summary
exists, and this is not a completed-suite pass. The run used separately owned
API/PostgreSQL containers, an actual tmpfs database and all 30 fresh migrations.
Exact container/network cleanup and retention of original identities were
verified afterward. Original data, the deployment owner's database/bridge and
Docker Desktop were not modified.

The observed PowerShell child consumed nearly one CPU-second per elapsed
second. A bounded synthetic probe established one concrete cost: for 30
registered materials and 100 nonsecret text fields after warmup, the helper
performed 3,000 redundant material JSON encodings in 1,330.49 ms. It also
re-sorted materials and rebuilt percent-escape regexes for every text field,
in both evidence-copy passes.

The follow-up prepares the same ordered replacements once per material-set
generation. Discovery still runs before replacement. New material grows the
run-owned set and triggers preparation on the same call; duplicate material
does not. Run initialization clears all preparation even if the new set has
the same count. Replacement order, duplicate variants, case handling,
two-pass sibling discovery and original HTTP values are unchanged. Prepared
material remains process-local and is never exported.

The same bounded probe now performs zero repeated material JSON encodings
and takes 416.16 ms, about 3.2 times faster for this synthetic case. This does
not prove sole causality for the hour-long run or an application latency
improvement. Complete live recovery remains a separate required result.

| Validation | Result |
|---|---|
| Existing redaction contract | All 213 prior assertions retained |
| Preparation regression | Observed RED for repeated encoding, then GREEN |
| Strengthened redaction contract | 255 passing assertions, including exact public JWKS, wrapped-array discovery and empty/singleton array-shape controls |
| Actual nested-script wiring | One Jest suite, nine passing tests |
| Endpoint ownership contract | 224 passing assertions, including unchanged HTTP response identity, text/byte admission and actual profile cleanup lifecycle |
| Full live recovery | Fresh PostgreSQL and InMemory each pass 1,845/1,845 with exact cleanup. The PostgreSQL private outer timestamp-verifier failure is separately reconciled; original failed attempts remain below. |

### JWKS dictionary collision and remaining text cost

The second complete candidate attempt reached 1,255 PASS lines and one FAIL
line before it was explicitly stopped. Section 9z-AM failed while serializing
the public JWKS response: `OrderedDictionary` keys must be strings. A JSON
member named `keys` shadowed PowerShell's adapted dictionary `Keys` property.
The redactor enumerated the payload value instead of the dictionary's keys.
This also affected discovery inside secret-valued dictionaries. Both sites now
use `PSBase.Keys`; focused hashtable and ordered-dictionary controls reproduced
the exact serialization failure before the fix and pass afterward. Original
responses remain unchanged, and earlier-sibling secret masking is verified.
The stopped run is not a completed-suite result. Its exact API, database,
network and private client directory were removed, original identities were
retained, and the Windows listener was absent.

A separate warm, 100-field/30-material experiment measured process CPU rather
than application latency. The prepared PowerShell path used 546.875 ms.
Moving only the ordered loop into a small in-process .NET helper still used
406.25 ms; guarding only impossible discovery matches used 218.75 ms. The
combined implementation used 46.875 ms, about 11.7 times less CPU than the
prepared PowerShell path in this case. The experiment's local 100 ms goal
failed for either partial change and passed for the combination. It is not a
new CI timing threshold, a full-run duration guarantee or an API benchmark.
These CPU measurements are distinct from the earlier elapsed-time probe.

The guards skip URI discovery only without `://`, assignments only without
either `=` or `:`, and authorization discovery only without either scheme
name, compared case-insensitively using the current culture to match the
existing regex behavior. The original matching expressions remain
authoritative when those necessary signals exist. The .NET helper applies
the same ordered string/regex entries, including duplicates; its type stores
no static material, and each run owns its prepared plan. Permanent controls
verify overlap order, mixed regex/string entries and duplicate preservation.
No token lifetime, HTTP value, assertion or application threshold changed.

| Issue | Type / severity | Root cause and correction | Detection / earliest possible |
|---|---|---|---|
| Public JWKS serialization and nested material discovery | Test correctness / High | An arbitrary dictionary member shadowed `Keys`. Use `PSBase.Keys` in both recursive traversal paths; preserve public shape, original values and sibling masking. | Late live section / focused arbitrary-JSON dictionary contract |
| Remaining interpreted text work | Tooling performance / Medium | Preparation reuse did not remove per-entry interpreted loops or unnecessary discovery regex calls. A measured combination of necessary-signal guards and the existing ordered plan in .NET removes those costs without changing matching semantics. Either partial experiment missed the local goal. | Bounded CPU experiment / hot-path experiment before another complete live attempt |
| Fast guard initially used a different case culture | Test correctness / Medium | An ordinal scheme-name precheck skipped an authorization string accepted by the existing current-culture regex. A Turkish dotted-I control observed RED, then GREEN after aligning the guard with `CurrentCultureIgnoreCase`. | Focused pre-commit parity probe / culture-equivalence contract when adding the fast guard |

After the culture correction, all 242 redaction controls pass. A fresh
process-CPU recheck used 15.625 ms for the same bounded input. The CPU timer
has coarse increments and these isolated values are not a stable capacity
benchmark; no CI timing requirement was introduced.

The subsequent real-JWKS wrapper probe rejected admission before starting
another complete suite: serialization no longer threw, but singleton `keys`
was an object rather than an array. A conditional expression assigned its
value through PowerShell's pipeline, which enumerated singleton arrays and
turned empty arrays into null. Assigning inside each branch preserves the
original collection. The exact shape regression observed RED, then GREEN.
All 250 redaction assertions now pass, including dictionary and custom-object
JWKS inputs and empty/singleton scalar arrays. The probe's exact API/database/
network/client directory were removed, original identities retained and
Windows listener absent. Complete live recovery is still pending.

| Additional issue | Type / severity | Root cause and correction | Detection / earliest possible |
|---|---|---|---|
| Empty and singleton evidence arrays lost their shape | Test correctness / Medium | Assignment from an `if` expression enumerated property values through the pipeline. Assign inside the selected branch. Existing count/value assertions also accepted singleton objects; new assertions require actual arrays. | Real JWKS wrapper preflight, before full suite / exact output-shape contract |

The next fresh fixture passed all four real JWKS wrapper checks, then its
complete live attempt aborted early during JSON log download with a false
cycle error. PowerShell can wrap an array so it satisfies both
`[pscustomobject]` and `IEnumerable`; treating it as a property bag traversed
collection metadata, including `SyncRoot` pointing to itself. Preserving
arrays exposed this previously hidden classification problem. Both copy
and discovery now prefer enumerable semantics over custom-object property
enumeration while retaining dictionary handling first. A synthetic
PowerShell-wrapped array reproduced the same cycle error before the fix.
All 255 controls pass afterward, including empty/single/multiple wrapped
arrays, nested material discovery and original preservation. The failed
attempt's exact fixture cleanup passed. The private admission now also
requires actual downloaded log-array evidence to retain its array shape
before another complete suite starts.

| Additional issue | Type / severity | Root cause and correction | Detection / earliest possible |
|---|---|---|---|
| Wrapped HTTP arrays falsely reported as cycles | Harness / Medium | A PowerShell-wrapped array also matched `pscustomobject`; property traversal reached its self-referencing collection metadata. Prefer `IEnumerable` before custom-object traversal in copy and discovery, retaining dictionary precedence. | Early live log download / wrapped-array representation contract before complete retry |

The subsequent unchanged live attempt reached 1,763 partial PASS lines and
four late correctness FAIL lines in approximately seven minutes, without
token expiry. It still has no final summary. All four nested PowerShell
contracts created endpoints through the real web wrapper, whose ownership
admission piped `byte[]` HTTP content directly to `ConvertFrom-Json`. That
pipeline parsed byte values rather than the JSON document, so registration
rejected a missing UUID. Exact container-level cleanup passed; the live
orphan-cleanup failure remains in its original receipt.

The wrapper now decodes only its local admission copy with strict UTF-8 before
JSON parsing. Strings remain accepted; invalid UTF-8, malformed JSON and other
body types fail closed. It still returns the original HTTP response and byte/
string representation, and original/unowned UUID rejection is unchanged.
The actual wrapper projection reproduced the same UUID error before the fix.
All 218 ownership assertions, 255 redaction controls and nine nested-wiring
tests now pass. Fresh admission additionally exercises the four real nested
contracts before another complete suite starts.

| Additional issue | Type / severity | Root cause and correction | Detection / earliest possible |
|---|---|---|---|
| Web-wrapper create admission did not decode bytes | Harness / Medium | The ownership wrapper parsed individual byte values, not the complete JSON document. Decode a local byte copy using strict UTF-8; preserve original response identity/body and require the same UUID ownership checks. | Late nested correctness contracts / real-wrapper text/byte admission contract |

With byte admission repaired, the next full attempt reached 1,845 partial
PASS lines and zero assertion FAIL lines but still aborted before the final
summary: orphan reconciliation retained one cleanup failure. The actual
profile section deleted its PATCH endpoint successfully, then its `finally`
block deliberately attempted the same DELETE again and swallowed the 404.
That historical call-site behavior conflicts with the correctly sticky
ownership guard. The guard was not relaxed. Successful early cleanup now
clears only that local reference; failure retains the UUID for `finally`,
reports the real failure and leaves sticky evidence intact. The existing
9z.36 assertion now checks actual success rather than unconditional true.

A contract executing the actual early and `finally` AST blocks observed RED
for two DELETE calls, then GREEN after the fix. Its failure control confirms
the later retry still runs and cannot erase the earlier failure. Ownership
now passes 224 assertions; redaction remains 255. Fresh real admission also
executes this actual profile lifecycle before another complete run.

| Additional issue | Type / severity | Root cause and correction | Detection / earliest possible |
|---|---|---|---|
| Successful profile cleanup attempted twice | Harness / Medium | A historical `finally` block swallowed the second DELETE's 404, but the newer ownership guard correctly retained that failure. Clear the local reference only after verified successful early deletion; preserve failed handles and sticky failures. | Final full-run reconciliation / actual call-site early/finally lifecycle contract |

Confirmed RCA: encoding, sorting and regex construction were coupled to every
text conversion rather than changes in discovered material. The executable
preparation-count assertion detects the mechanism without a flaky elapsed-time
threshold. The real live expiry was detected late; a stable-registry
work-count contract could have caught this redundant work before runtime.
Missing test discovery in VS Code and missing local Jest dependencies were
tooling preconditions: the targeted CLI run exposed the missing executable,
then locked `npm ci` restored 660 API packages without changing lock bytes.
The existing audit reported 22 Moderate findings; no dependency was upgraded.

Test/gate self-improvement: applied. Reuse, duplicate registration,
same-count fresh-run invalidation and late-sibling discovery are in the
existing default-running contract, together with the JWKS collision and
ordered-plan equivalence controls. Design/architecture disposition: applied.
The small in-process loop remains inside the cohesive evidence helper and is
justified by measured interpreter cost; another service, strategy interface
or dependency would be speculative. Normal review/integration and the
remaining qualification lanes are still required.

### Complete PostgreSQL recovery and private verification correction

The next unchanged full PostgreSQL invocation completed: child exit zero,
169 sections, 1,845/1,845 assertions, zero failures, 2,060 flow steps and
450.6 seconds. Ownership reported no cleanup failures. Exact parent-owned
API/database/network/client-directory removal, original identity retention
and Windows listener closure passed.

Its private outer verifier still exited one because it attempted to parse
the evidence payload's redacted timestamp. Exact material masking can also
mask short strings that occur in metadata; the redactor must not exempt
metadata or discard short material to make a verifier pass. The original
failed outer receipt is retained separately from the reconciled acceptance.
The replacement private check proves exact target, a result-file write
within the recorded owned child invocation and a changed hash when an older
file exists. Actual-result negative controls reject wrong target, stale
write, future write and unchanged hash. Both executed source hashes are
independently unchanged. The recovered result is copied to a run-specific
private artifact before another backend can overwrite the latest file.

| Issue | Type / severity | Resolution and why | Detection / earliest possible |
|---|---|---|---|
| Private verifier parsed redacted metadata as raw ISO | Tooling / Low | Preserve redaction and the failed receipt; verify freshness using the owned invocation/file interval and exact target, with source hashes and negative controls. | After complete live execution / private verifier contract with redacted metadata |
| Missing local documentation/typecheck dependencies | Environment / Low | Actual missing-tool failures preceded normal locked root/web `npm ci`; all three tracked lock hashes remained unchanged. | Chosen validation commands / dependency availability at validation startup |
| Root documentation graph audit findings | Dependency / High | Initial root tooling audit reported `markdown-it` High, one Moderate and two Low. Separate #284 now has a CI-authenticated Markdown 14.3.3 lock and zero High/Critical locally; all 29 final normal Fast gates and all six exact-tip PR checks pass. Independent review remains pending because Copilot review quota is exhausted. This harness unit changes no dependencies. | Actual root restore/audit / root dependency audit before release |

The root audit is distinct from unchanged API runtime dependencies and from
the successful live result. The public
[markdown-it advisory](https://github.com/advisories/GHSA-vfgh-jcmw-g37q)
describes repeated unterminated inline HTML constructs causing quadratic
parsing with HTML enabled. Remediation and approved-feed publication-age
qualification belong to the separate tooling-only
[repair #284](https://github.com/pranems/SCIMServer/pull/284), not this harness
rollback unit. Its local locked audit retains one Moderate and two Low
findings. Accepted master still has the earlier graph until normal reviewed
integration; no all-security-green or release acceptance is claimed.
Owner: repository maintainer; target: before release acceptance.

Fresh InMemory qualification subsequently completed with outer/child exit
zero: 169 sections, 1,845/1,845 assertions, zero failures, 2,060 flow steps
and 421.5 seconds. Exact container/client-directory cleanup, original identity
retention and listener closure pass. Both run-specific sanitized results
remain private. No parent fixture remains. These local complete results
do not establish application-latency, shipping, Azure or Desktop-removal
acceptance.

**RCA provenance:** the entire parent JSONL stream was scanned incrementally.
The previously reviewed 20:45:06.146 to 21:25:04.676 UTC interval covered 846
later events, 85 signal candidates and 23 explicitly classified execution
results. The next interval, through **2026-11-23T22:13:59.179Z**, covers 1,037
later events, 52 candidates and 20 explicitly classified execution results,
including the successful InMemory outcome and separate root-tooling work.
Both reviews have zero undisposed candidates. Error/signal and
diagnosis-narration passes, followed by execution-purpose and causal-marker
review, distinguished actual failures from source/read/search echoes and
expected negative controls. Prior reviewed receipts remain intact.
Missing-tool failures, real byte/profile REDs, cleanup outcomes and the private
timestamp failure have entries above; dependency-bootstrap issues belong to
the separate tooling repair's supply-chain RCA. Successful read/status
commands, expected trap output and already-diagnosed source echoes were not
counted as new incidents. No raw transcript or credential material was
exported. Later normal push/PR events are separate evidence and do not extend
this bounded transcript-review cutoff.

## Evidence boundary

[`scripts/live-evidence.ps1`](../scripts/live-evidence.ps1) owns the evidence-copy policy.
`ConvertTo-LiveEvidence` discovers secret material, then makes a second copy
so earlier diagnostic fields cannot retain a value declared in a later sibling.
It handles dictionaries, PowerShell custom objects, arrays, UTF8 bytes,
JSON strings, URL/form assignments and plain diagnostic text.

The original values and the evidence copies travel on separate paths:

```text
Original request -> native HTTP -> original response -> live assertions
       |                                |
       +---- evidence copy boundary ----+
                      |
             sanitized flow collection
                      |
        console formatting / final JSON serialization
```

The material-key policy follows the existing shared redactor's recursive-copy
approach in `api/src/security/redact-sensitive.ts`, but deliberately does not
copy its broad substring key matching. Names such as `issuedTokenTtlSec`,
`credentialId`, `tokenEndpoint` and `client_assertion_type` are metadata, not
secret values. Actual response shapes were checked in
`api/src/oauth/oauth.controller.ts`,
`api/src/modules/scim/controllers/admin-credential.controller.ts` and
`api/src/modules/scim/services/connection-info.service.ts`. They include
`access_token`, bearer `token`, OAuth `clientSecret`, and connection-info
`entraFields.secretToken` / `entraFields.clientSecret`. Passwords, assertions,
refresh tokens, authorization/cookie/API-key headers and encrypted credential
material are also excluded from evidence.

Textual Bearer and Basic authorization also participate in material discovery,
not just masking. Valid Base64 Basic text additionally contributes decoded
`user:password` and password material. URI username-only authority values are
masked but do not register a standalone account name as a secret. Only the
exact canonical `[REDACTED]` marker is exempt from registration; a real
credential containing that substring is still material.

The run keeps an in-memory set of configured and observed secret strings,
including URL-encoded and JSON-escaped spellings. This lets errors and URL
segments that echo a previously observed credential be sanitized even when
they have no secret-named field. It is not a general detector for arbitrary
unknown plaintext without a material key. It never writes the set to disk.

| Surface | Boundary before output |
|---|---|
| Request/response bodies and headers | `Add-FlowStep`, `Convert-FlowBody`, `Convert-FlowHeaders` |
| Flow action, URL and error text | `Add-FlowStep` evidence copy |
| Verbose output | `Write-VerboseLog` calls `Format-LiveEvidence` before truncation |
| Dynamic console strings and assertion messages | Explicit `Write-LiveEvidenceHost` calls and `Test-Result` |
| Run-specific/latest JSON | `ConvertTo-LiveEvidenceJson` before the existing two file writes |
| OAuth token acquisition | Fixed success message, no token prefix |

The native HTTP parameter forwarding, returned responses and original request
objects remain unchanged. Invalid JSON or UTF8 produces an explicit
`_evidenceError` with a length, not raw bytes or a success-shaped body.
That evidence diagnostic must not prevent the original malformed request
from reaching HTTP negative tests. Cyclic objects and excessive nesting throw
fixed, nonsecret errors rather than falling back to raw serialization.

No post-write scrubbing, console interception or credential recovery is used.
Literal progress messages still use `Write-Host`; dynamic runner messages use
the explicit protected sink. The contract checks for a bypass.

## Confirmed root causes and prevention

| Issue | Type / severity | Root cause and fix | Detection boundary |
|---|---|---|---|
| Raw credential evidence | Security / High | `Convert-FlowBody` returned original objects or raw strings; `Add-FlowStep` retained them; final serialization wrote them. Shared copying now precedes storage and serialization. | Preflight concern, reproduced by the first pure PowerShell assertion. Earliest boundary: unit contract for evidence conversion. No live run was started. |
| Console prefix leakage | Security / High | Verbose wrappers truncated raw bodies, printed raw error/URL text, and token acquisition printed 30 token characters. Protected explicit output and pre-truncation formatting replace these paths. | Source inspection; executable console/sink contract is now the earliest boundary. |
| Marker recursion | Tooling / Medium | The initial helper treated an already-redacted string as enumerable after skipping registration, recursing into the same string. The bounded contract stalled; registration now returns for every string, including empty/redacted values. | Focused GREEN candidate, before runtime. Repeated redaction assertions cover idempotence. |
| Quoted header drift | Test correctness / Medium | Parsing a JSON-quoted ETag dropped its quotes. Quoted scalar evidence now preserves its encoded string representation. | Header value assertion in focused contract, before runtime. |
| URL query hidden by scheme | Security / High | An initial assignment regex consumed an entire URL as the nonsecret `https:` value and skipped the first sensitive query key. Matching key/separator positions first and replacing only sensitive values fixes the overlap. | Unique encoded-key/fragment contract; earliest boundary is the pure text helper test. |
| Patch context mismatch | Tooling / Low | Combined patches rejected expected context. The first added only the helper, while another updated only the test. A later documentation-only patch also rejected an expected line. File contents/status were checked before applying remaining smaller patches. | Edit-tool feedback, immediately; no runtime or git operation was affected. |
| Newline-dependent trap check | Test correctness / Low | A source-string assertion assumed LF line endings in a CRLF runner and falsely rejected the new failure trap. A whitespace-tolerant check now verifies the actual trap and a child PowerShell process proves exit 1 with protected output. | Focused contract, before runtime. |
| Nested script evidence state | Lifecycle / High | The normal API unit hook first caught an extracted `Add-FlowStep` harness missing its new helper dependency (one failure/eight passes). Loading and initializing the real helper then exposed the actual nested-script bug: PowerShell resolves `$script:` against the invoking child, so initialized secrets were absent. Run state now uses the same explicitly named root/global ownership pattern as the existing flow collection. | Focused helper tests missed the nested caller. The existing nested-flow Jest test now loads the actual helper and requires root step IDs, a redacted copied body, retained nonsecret metadata and an unchanged original response. Confirmed RED, then nine tests PASS; all 213 independent redaction assertions still PASS. No live run or shipping occurred. |
| Competing fatal traps bypassed cleanup | Lifecycle / High | The new protected trap exited 1 before the existing `Invoke-OrphanReconciliation; break` trap could run cleanup. The first child test extracted only one trap and falsely suggested the error path was complete. There is now one authoritative trap: retain the original failure, invoke cleanup, protect any cleanup exception, protect the original failure, then exit 1. | Independent review executed both actual `EndBlock.Traps` in one child scope and observed cleanup absent. Earliest boundary: the full script-level trap topology contract. The initial first-trap-only test was a detection escape, not complete lifecycle evidence. |
| Userinfo masking did not discover credentials | Security / High | The final HTTP-only URL regex removed userinfo from its own field but did not register its encoded/decoded value or password. Earlier diagnostic siblings therefore retained recognized authentication material on the second copy. The text boundary now discovers raw/decoded userinfo and password before masking authority credentials for any hierarchical URI scheme. Encoded variants recognize percent-escape hex casing without case-folding the plaintext secret. | Independent review used an empty secret set and a unique userinfo/password sentinel echoed in an earlier sibling. The earlier direct-URL check passed without proving sibling discovery; that was a detection escape. Earliest boundary: isolated userinfo-plus-sibling contracts. |
| Bearer/Basic text still bypassed discovery | Security / High | The final authorization-text regex replaced its own match but did not register it. It now registers the full match and token before masking; valid Basic Base64 also contributes decoded credential/password material through the same credential-pair boundary as URI userinfo. | Independent fresh-registry sibling controls exposed the leak after 186 prior assertions passed. Earliest boundary: independent authorization-text/password sibling controls, not only sensitive header-key tests. |
| Marker substring exempted real credentials | Security / High | `Contains('[REDACTED]')` incorrectly exempted real secrets and userinfo containing the marker in a longer value. Exact, case-sensitive marker equality now exempts only the canonical marker. | Independent marker-substring `client_secret` and URI-password RED controls. Earliest boundary: material acceptance tests distinguishing exact markers from real values containing them. |
| Username-only URI destroyed account metadata | Contract correctness / High | Registering every complete URI userinfo value made username-only authorities classify ordinary account names as secrets. Shared credential-pair discovery now registers whole userinfo/password material only when a password separator is present, while authority masking remains unconditional. | Independent fresh-registry SSH username-only metadata RED. Earliest boundary: negative metadata preservation controls for recognized authority shapes without a password. |

The causal RED was `Convert-FlowBody leaks OAuth/admin secret values into
evidence.` The focused contract loads actual runner function definitions and
the production helper without starting the runner. It verifies synthetic
sentinel absence, unchanged inputs, status preservation, diagnostic metadata,
nested arrays, malformed-body diagnostics and sink wiring.

Initial focused result: **87 assertions passed**, including independent
material values for each sensitive key, repeated redaction, nonsecret
metadata, encoded URL keys and the actual fatal trap. The default pre-push
contract registration is checked without running the hook. The registry and
Copilot customization contracts also passed. All four changed PowerShell
files parsed successfully and `git diff --check` passed. That result did not
prove cleanup because its fatal-path child selected only the first trap.

The follow-up contract first reproduced the actual-topology RED:
`Full script-level trap topology skipped orphan cleanup.` After consolidation
to one trap, **96 assertions passed**. Both success and failure callbacks
emit a protected synthetic cleanup echo; cleanup failure also throws a
synthetic secret-bearing exception. The contract runs every actual root trap
in the same child scope, requires cleanup observation, both protected failure
diagnostics when applicable, no sentinels, exit 1, and unchanged locally caught
negative-test errors. It also requires exactly one authoritative root trap.
No real cleanup or HTTP request was executed.

The second follow-up first reproduced `Recognized https userinfo password
leaked into an earlier sibling.` Its independent userinfo controls initialize
an empty secret set each time, compare original input bytes, preserve
nonsecret metadata and standalone usernames, and require idempotent serialized evidence. **186 focused
assertions passed** after discovery was corrected, including HTTP, HTTPS,
PostgreSQL, Redis and MongoDB SRV URI schemes, raw/encoded userinfo/password
echoes, fully encoded authority credentials, and all previous 96 controls.
No URI was connected to a network.

The third follow-up reproduced all three independent parent counterexamples
before source edits, plus raw/decoded Basic and URI-marker variants. **211
assertions passed** when those mechanisms were corrected. The earlier 186
PASS is retained as history, not treated as evidence for these missing claims.
Each new control begins with an empty registry, checks original input equality
and idempotence, and distinguishes material exclusion from account metadata
preservation. The authoritative trap and all previous controls remain intact.
The final strengthened result is **213 passing assertions**: marker-substring
controls additionally reject the unique sentinel itself, so partial
redaction cannot hide behind absence of the complete credential.

Completeness note: the issues above are reconciled against the tool outputs
and direct implementation history of this bounded fix. This is not a claim
to have reconciled the parent's complete deployment transcript. The stopped
processes were only owned pure PowerShell contract processes.

## Review and remaining qualification

- Review the exact key policy against any new authentication response shapes.
- Run the default evidence contract and required consolidation gates during
  normal review, without claiming the parent's older runtime proves this tip.
- The runtime owner must qualify this tip on an isolated disposable target
  because complete-suite global mutations remain separate from endpoint
  ownership. Run on proven owned fixtures,
  inspect both JSON exports and console output, and independently verify
  that real authentication and positive admin sentinel assertions still pass.
- Original HTTP exceptions remain available to caught negative tests.
  Unhandled failures reach a script-level trap, which emits a protected
  diagnostic and exits 1 rather than allowing host error formatting to
  disclose the original payload. Future external helper console sinks need
  separate review.
- No version, dependencies, release artifact or deployment was changed.

Test/gate self-improvement: applied. A default-running pure PowerShell
regression contract covers the evidence boundary, output ordering and
nonsecret metadata rather than only checking for successful HTTP status.
The follow-up closes the lifecycle detection escape by executing all actual
root traps together and asserting cleanup, not a first-trap proxy.
The userinfo follow-up additionally requires independent sibling-echo controls
for every recognized material source, not just masking within its own field.
The third follow-up strengthens that invariant with Bearer/Basic text,
decoded Basic passwords, marker-substring material, and username-only
authority metadata controls. A mask rule is incomplete until its discovery
and metadata boundaries have independent fresh-registry assertions.

Architecture disposition: accepted. One small cohesive helper owns copying,
material discovery and evidence formatting. The large runner only invokes
that boundary; another strategy/interface layer would be speculative.
The follow-up applies one authoritative lifecycle trap rather than competing
error owners. Historical scope boundary: cleanup ownership selection was
repaired separately in #281, not redesigned inside the redaction fix.
Userinfo discovery extends the existing text/material boundary; no transport
dependency or scheme-specific strategy was introduced.
Applied: URI and decoded Basic credentials share one small credential-pair
discovery function, preventing duplicated username/password policy. It has
two real callers; no new transport, dependency or ownership abstraction is
introduced.
