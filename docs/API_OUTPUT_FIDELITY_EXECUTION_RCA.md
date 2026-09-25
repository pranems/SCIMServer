# API Output Fidelity Execution Issues and RCA

> **Release:** v0.55.33
> **Last verified:** 2026-09-24
> **Companion contract:** [API_OUTPUT_FIDELITY_AND_SECRET_SURFACE_CONTRACT.md](API_OUTPUT_FIDELITY_AND_SECRET_SURFACE_CONTRACT.md)

## Summary

This change began with case-sensitive custom ResourceType URLs and expanded after live and source audits found independent output-fidelity, secret-surface, Settings, and test-harness defects. Every issue below was captured when its RED check became GREEN.

| ID | Type | Severity | Symptom | Root cause | Resolution and prevention |
|---|---|---|---|---|---|
| F1 | API routing | High | `/Devices` worked while `/devices` returned 404 | ResourceType matching compared configured identifiers exactly | Central case-insensitive resolver plus mixed-case unit, E2E, and live variants |
| F2 | API routing | High | Lowercase Bulk collection paths returned operation status 400 | Bulk dispatch switched on exact `Users` and `Groups` strings | Canonicalize built-in collection names before capability checks and dispatch |
| F3 | Backend parity | High | Uppercase UUID URL segments worked in PostgreSQL but not InMemory | InMemory repositories compared SCIM IDs exactly | Normalize SCIM ID comparisons and `findByScimIds` sets; repository parity tests |
| F4 | Database integrity | High | Endpoint names differing only by case could race past application checks | Cache and database uniqueness were case-sensitive | Lowercase cache keys, insensitive Prisma reads, and additive unique index on `lower(name)` |
| F5 | SCIM PATCH | High | `Status` created a duplicate beside `status`; mixed-case valuePath returned `noTarget` | Generic object-key access used caller casing | Shared case-insensitive property-key resolver at every read/write/delete sink |
| F6 | Discovery | High | OAuth client credentials were enabled but absent from SPC schemes | Scheme computation used explicit method entries and WIF only | Use complete effective authentication enablement; E2E and live scheme checks |
| F7 | UI runtime truth | Medium | Settings showed blank inherited WIF/JWKS inputs | UI reconstructed values from profile overrides instead of the runtime read model | Shared egress field map and authoritative 11-field API query; measured Playwright assertions |
| F8 | Response contract | High | Mixed-case extension URN could bypass `returned:never` filtering | Payload extension lookup used exact object keys | Case-insensitive lookup, canonical URN emission, and filtering test |
| F9 | Response contract | High | Custom payload could overwrite `id`/`meta` or expose internal persistence keys | Generic serializer spread raw payload after server-owned fields | Recursive internal-key sanitizer across User, Group, and custom responses |
| F10 | Secret UX | High | Credential, method, and endpoint exports omitted recoverable secrets | Export builders deliberately used a public credential projection | Authenticated admin projection includes retained values; automatic reveal queries and browser copy test |
| F11 | Secret policy | High | `once` could purge data needed by the required always-visible admin contract | Legacy visibility control remained writable at server and endpoint scope | New writes accept only `always`; fixed UI status; legacy purged values require rotation |
| F12 | Durable disclosure | High | RequestLog and Workbench history could retain plaintext credentials | Both durable stores preserved live request/response objects by default | Mandatory recursive redaction before persistence; sentinel unit, E2E, and live checks |
| F13 | Navigation analysis | Medium | Audit claimed Back could leave the app through external history | Audit assumed `useCanGoBack()` used browser history length | Read TanStack source: it uses `__TSR_index`; added explicit external-history fallback regression test |
| F14 | Tooling/worktree | Medium | Search results contradicted current source | Workspace tools indexed the older root worktree while implementation lived in `SCIMServer-master` | Pin every audit and command to the authoritative absolute worktree; verify branch and HEAD first |
| F15 | Test environment | Medium | Browser RED still showed removed controls | Playwright reused a stale Vite server on port 4000 | Isolated frontend/API ports with explicit proxy target; exact-branch rerun passed |
| F16 | Environment | Low | Prisma validation URL later broke E2E setup | Dummy `DATABASE_URL` remained in the persistent terminal environment | Clear temporary variables immediately and isolate one-shot validation commands |
| F17 | Migration design | High | Initial CITEXT conversion failed the destructive-migration gate | Altering a live column type is a risky rewrite | Replaced with additive preflight plus unique expression index; migration linter 0 violations |
| F18 | Test correctness | Medium | Full live/E2E failed after intended policy changes | Existing assertions encoded retired `once` and raw-preview behavior | Replaced with rejection, no-purge, retained-secret, and redaction outcomes; full suites GREEN |
| F19 | Upgrade security | High | Legacy RequestLog and Workbench rows could remain plaintext after upgrade | Redaction originally ran only on new writes | Sanitize RequestLog detail and Workbench history on read; rewrite local history; Prisma and InMemory tests |
| F20 | Session security | High | Revealed values could survive logout in TanStack Query cache | Reveal queries used stable keys and normal garbage collection | Remove the reveal namespace on every token change and set reveal-query `gcTime` to zero |
| F21 | Concurrency | Medium | Simultaneous case-only endpoint creates could surface database `P2002` as 500 | Preflight and unique index left a race window | Map `P2002` to the documented duplicate-name response; focused unit lock |
| F22 | PATCH parity | High | User/Group custom and no-path fields still accepted caller casing as a new key | Generic engine used the shared resolver first; older engines retained local sinks | Reuse the property resolver in explicit, nested, and no-path paths; User/Group parity tests |
| F23 | Migration packaging | High | Renaming a migration left an empty discoverable directory | File deletion did not remove its parent directory | Remove the empty directory and run migration lint against filesystem discovery |
| F24 | Durable disclosure | High | Secret-bearing query parameters could persist in URL fields | Header/body redactors did not inspect query keys | Shared query-key URL sanitizer for structured logs and RequestLog plus Workbench path sanitization and sentinel tests |
| F25 | Security gate | High | PR CodeQL reported 16 high-severity remote-property-injection alerts at PATCH sinks | Case-insensitive key canonicalization passed through `resolvePropertyKey`, so CodeQL no longer recognized the earlier prototype guard as a barrier at the final assignment/delete | First attempt wrapped every resolved key at the sink; runtime tests were green but CodeQL still failed, proving sanitizer layering was not a structural closure |
| F26 | Documentation gate | Low | Pre-push rejected the CodeQL follow-up because PATCH source changed without its coupled guide | Security behavior changed at the source boundary but the operator guide had no sink-level explanation | Added the case-insensitive canonicalization and final-sink prototype barrier contract to the PATCH guide; doc freshness/content rerun required |
| F27 | Test correctness | Medium | Dev Playwright waited for a Saved banner after filling `JwksRefreshIntervalMs` with `3600000` | Settings now displays the inherited effective value, and `3600000` is the built-in value; filling the same value correctly takes the no-op path | Use `7200000`, a distinct in-range value, and rename the test to cover the complete numeric surface; rerun focused Playwright against dev before closing Stage 5 |
| F28 | Test correctness | Medium | Full dev Playwright expected the retired `once` radio, counted `PersistRequestSecrets` as an editable label, and required 20 switches | The v0.55.33 UI intentionally replaced those mutable controls with fixed always-retain and always-redacted status surfaces | Assert removed controls stay absent, fixed status text is visible, and the editable switch floor is 19; rerun the three focused tests and the complete dev suite |
| F27 | Security gate | High | Second CodeQL run increased to 21 high remote-property alerts despite explicit sink guards | The analyzer still modeled user-controlled property names at dynamic assignments/deletes; a validated string was not a provable barrier | Replaced canonicalized writes/removals with immutable `Object.fromEntries` reconstruction helpers, eliminating the sink category; PATCH suites 330/330, lint 0 errors, build green; exact-tip CodeQL rerun required before merge |

## Escape Analysis

| Issue class | First detecting check | Earliest practical check | Escape delta | Closure |
|---|---|---|---|---|
| URL casing | Operator report and focused E2E | Mixed-case route contract at original feature delivery | Escaped to dev | Permanent identifier rule plus unit/E2E/live variants |
| SPC mismatch | Live endpoint inspection | Effective-setting E2E | Escaped to dev | Scheme resolver parity test |
| Settings blanks | Operator report | Browser outcome assertion against egress API | Escaped to dev | All 11 values compared in Playwright |
| Secret export omissions | Source audit | Secret-bearing serializer component test | Escaped to dev | Admin projection tests and clipboard browser proof |
| Internal key leak | Independent audit | Response denylist on custom resources | Latent, caught pre-release | Shared recursive sanitizer |
| Durable secret copies | Independent security audit | Default-redaction unit test | Latent, caught pre-release | Mandatory persistence boundary |
| Destructive migration | Migration linter | Same gate | Zero | Additive redesign before consolidation |
| Stale branch server | Playwright RED | Exact-branch isolated server | Same activity | Isolated-port convention recorded |

## Self-Improvement Dispositions

**Test and gate:** applied. URL identifiers now require mixed-case positive tests at resolver, HTTP, Bulk, PATCH, and live layers. Secret-bearing admin exports require positive sentinel checks, while public and durable surfaces require negative sentinel scans. Browser tests compare displayed outcomes to the authoritative API object.

**Design and architecture:** applied. ResourceType resolution, PATCH key resolution, egress metadata mapping, and response sanitization each have one owner. Endpoint-name case-insensitive uniqueness is enforced at the database boundary. The secret boundary separates live authenticated admin disclosure from durable storage and public protocol output.

**YAGNI counter-check:** accepted. No generic policy engine or serializer framework was introduced. The new helpers each have multiple concrete consumers and remove active duplication.

## Provenance

The ledger was reconciled against the complete session transcript using two passes: failure-signal search (`FAIL`, `RED`, `EADDRINUSE`, migration, stale server, case-sensitive, secret, `once`) and diagnosis-language search (`root cause`, `stale`, `turned out`, `falsified`, `blocked`). Search echoes and expected negative-control failures were dismissed. The focused RED failures, their GREEN reruns, the full 1,532-assertion live gate, and the full unit/E2E summaries were cross-checked against command artifacts.
