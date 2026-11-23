# Live integration evidence redaction

**Last verified:** 2026-11-21

## Executive summary

This is a source-only, unreleased correction to the live integration runner.
Authentication and credential material must reach real HTTP requests and
positive administrator assertions, but must not reach console output or the
run-specific and latest evidence JSON files. No complete live runner was
started for this fix. Runtime qualification and deployment remain separate
review obligations.

**Separate ownership blocker:** Do not execute this live runner against a dev
estate containing original data. The existing name-based cleanup sweep can
select unowned original endpoints, and inventory-difference reconciliation
can select endpoints created concurrently by another owner. Redaction does
not prove cleanup ownership. That existing issue needs its own coherent fix
before original-data dev live execution; it is not redesigned in this change.

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
- The runtime owner may qualify this tip only on an isolated disposable target
  with no original or concurrently owned endpoints until the separate cleanup
  ownership fix is reviewed. After that fix, run on proven owned fixtures,
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
error owners. Accepted scope boundary: cleanup ownership selection remains
a separate blocker, not an additional redesign inside this redaction fix.
Userinfo discovery extends the existing text/material boundary; no transport
dependency or scheme-specific strategy was introduced.
Applied: URI and decoded Basic credentials share one small credential-pair
discovery function, preventing duplicated username/password policy. It has
two real callers; no new transport, dependency or ownership abstraction is
introduced.
