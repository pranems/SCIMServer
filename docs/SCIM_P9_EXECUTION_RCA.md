# P9 compatibility execution issues

**Last verified:** 2026-09-29

Companion: [compatibility](SCIM_ENTRA_COMPATIBILITY.md) and
[setting evidence](SCIM_SETTINGS_BEHAVIOR_EVIDENCE.md).

| Issue / type / severity | Symptom and cause | Resolution and why | Detection / earliest practical gate |
| --- | --- | --- | --- |
| Guidance / product documentation / High | Startup recommended strict-off for all Entra; registry descriptions repeated it and described retired secret policies as effective | Applied emitted-log and description RED/GREEN tests; corrected narrowly without changing policy/defaults | P9 test / original guidance unit test |
| Tool adapter / tooling / Low | VS Code runTests/problems and container configuration tools returned generic execution failures; docs catalog had no Microsoft server | Used existing npm/Jest and guarded Docker harness, official Microsoft fetches and RFC browser; no new framework | Tool call / same |
| Dependencies / environment / Low | Fresh worktree lacked Jest and generated Prisma types | After actual missing failures, used approved original node_modules junctions; generated Prisma only into this worktree's configured output | First targeted execution / same |
| Fixture profile / test correctness / Low | User create missing displayName and PUT missing emails failed under entra-id's required declarations | Included effective-profile requirements; did not disable strict validation or weaken required checks | First corpus run / reading effective preset before authoring |
| Delete/wrapper expectation / test correctness / Low | Initial boundary probes assumed 403 delete-disabled and invalidValue wrapper errors | Product uses 400 for disabled deletion and invalidSyntax for unsupported active array; asserted exact envelopes and unchanged resources | Corpus / contract inspection |
| Dotted path / correctness / High | Strict=true plus verbose=false produced 200 with literal name.familyName and unchanged nested name | Kept desired rejection as executable integration I03; P2 owner notified. No false-green malformed-state baseline | Corpus outcome check / PATCH unit regression |
| Counting/settings drift / documentation / Medium | Reference said 38 keys, omitted three cap rows, and claimed secrets could be logged and once visibility supported | Reconciled all 37 keys, separated fixed controls from UI toggles, marked config-only versus behavioral coverage | Source/evidence review / documentation inventory sentinel |
| Negative control / test correctness / Low | Row-removal fixture did not remove a CRLF-terminated row, so negative control unexpectedly passed the checker | Made deletion regex accept CRLF and LF; five guidance/inventory tests now pass, including the deliberately missing row | Negative control / same |
| Renderer discovery / tooling / Low | Existing doctor claimed editor Mermaid 0.0.0 while 11.15.0 rendered successfully | Recorded parity as unverified; no nonsensical dependency downgrade. Diagram renders in both themes | Render gate / existing documented environment limitation |
| Verified-target pinning / harness / High | Parent review identified a gap between checking marker absence and ordinary app bootstrap reading a marker that could appear later | RED showed a later competing URL won; GREEN adds optional pinned URL with owned helper, matching committed P5 design. P9 clears inherited URL and uses TCP readiness. Both owned HTTP/live backends rerun green | Parent harness review / bootstrap negative control |
| Integration ownership / process / Medium | Initial I03 label implied P2 would remove historical literal-key mode | Frozen P2 owner explicitly preserves it. Reclassified I03 as an open compatibility-policy proposal; no speculative default/semantics change | Cross-worker handoff / acceptance-boundary agreement |
| Receipt parsing / tooling / Low | Loading a JSON-formatted `.log` using `require` treated it as JavaScript and raised SyntaxError | Used `JSON.parse(readFileSync(...))`; no artifact or database change | Summary extraction / same |
| Policy scope / documentation / Medium | P2/P7 handoffs clarified strict-OFF adapter conversion and whole-profile revalidation of legacy global uniqueness, neither closed by a green P9 strict-ON corpus | Explicitly scoped the corpus to strict ON, assigned active conversion to unresolved parent/P7b policy, documented unrelated profile edits blocked by global without relabeling the RFC keyword invalid. Confirmed merged validation in this worktree source | Cross-worker handoff / source-policy compatibility review |

The first confirmed guidance fix was captured after its RED/GREEN run.
The fixture errors are harness errors, not product regressions. I03 is open
until integration and is never included in the supported passing count.
The initially tentative pathless modern case actually passed and was promoted
to supported E17. I02 primary handoff and I03 literal-key safety were both
executed and failed on the base; I02 remains a P2 integration check and I03
is an open policy proposal, not a P2 promise. The source already enforced
PostgreSQL >=17.8 within major 17; the initial follow-up message describing
that guard as major-only was incorrect and required no code change.

## Provenance and completeness

This ledger covers the P9 worker's complete visible tool/message history from
the assigned base, not the parent's or siblings' work. Signals reconciled:
missing jest, missing generated Prisma, tool failures, initial corpus
failures, exact contract mismatches, GREEN guidance and both backend/live
results, parent safety handoff, pinned-URL RED/GREEN and hardened rerun.
No full transcript file was available through the worktree; this is
**not a claim of full JSONL transcript reconciliation**. Parent consolidation
must reconcile the parent transcript before declaring the entire build ledger
complete. Verified non-issues: ephemeral local signing-key warning is expected;
two TODO cases are explicit integration work, not skipped passing tests.

**Test/gate improvement applied:** actual emitted guidance is asserted, and
HTTP/live use one corpus with GET readback, value/key checks and cleanup.
**Design disposition accepted:** shared test data and thin adapters avoid
duplicated scenario drift without introducing production abstractions.
The final policy clarification is documentation-only; existing semantics and
stored profiles stay untouched, and no speculative migration is introduced.
No protocol default, schema validator, UI, version or lockfile changed.
