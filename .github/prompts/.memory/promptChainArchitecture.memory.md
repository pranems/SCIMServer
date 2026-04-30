# Prompt Chain Architecture - Memory

> Persistent learnings across runs of `promptChainArchitecture`. Read at Step 0; appended at Step 13. Patterns observed twice are promoted from per-run logs into the top sections.

## Heuristics That Worked

(empty - populated as repeat-successful patterns emerge)

## Anti-Patterns Hit

(empty - populated as repeat-failure patterns emerge)

## Lessons Learned (Project Constraints Discovered)

- Project forbids em-dash characters (Unicode U+2014) in any file.
- Response contracts use key allowlist assertions, not just `toHaveProperty`.
- Internal fields prefixed with `_` must never appear in API responses.
- Features require unit + e2e + live tests + dedicated doc + INDEX.md + CHANGELOG.md + Session_starter.md updates.
- Documents follow blockquote-metadata-header convention (status / owner / date / version / related-rfcs).
- Mermaid diagrams (flowchart, sequenceDiagram, erDiagram) are the diagramming standard.

## Stage-Level Lessons (per-stage failure modes seen)

- Stage 1: Initial scans tend to anchor on the favourite product; force >= 8 with explicit verdict reasoning.
- Stage 3: Filesystem reads on the request path are often missed; explicitly ask "every synchronous I/O".
- Stage 6: Models slip back into prior context; restate "forget everything" if context is heavy.
- Stage 9: TBD cells appear when an adapter is fuzzy; demand the parity test name in the cell.
- Stage 11: Decision logs without rejected alternatives are common; require an Alternatives column.
- Stage 12: Accessibility and observability are the most frequently missed gaps.

## Prompt Evolution Proposals

(empty - any user-approved proposals are merged into the prompt file directly)

## Run Log

### Run 0 - Methodology origin (April 29, 2026)

Source run that produced this prompt. Investigation: SCIM Server admin UI redesign. Output: [docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md](../../../docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md) (1,388 lines, 24 sections, 13 decisions, 42-step plan).

What worked:
- Two unconstrained rounds (Stages 5 and 6) with progressively stronger constraint phrasing surfaced shadcn/ui as a serious alternative to the obvious Fluent UI default.
- Demanding numbers in Stage 3 caught 4 perf bottlenecks (N+1 activity feed, COUNT storms, FS version reads, O(E*4) endpoint stats).
- Multi-mode matrix in Stage 9 forced the mode-agnostic DI rule (services inject IRepository, never PrismaService).

What failed and was recovered:
- First Stage 3 pass missed synchronous filesystem reads; recovered by re-asking "list every synchronous I/O on the request path".
- First Stage 10 pass had frontend and backend independently defining `DashboardResponse`; recovered by adding Phase 0.1 (shared types as single source of truth).
- First Stage 11 decision log lacked rejected alternatives; recovered by adding an Alternatives column.
- Stage 11 missed accessibility entirely; Stage 12 gap-fill added the WCAG 2.1 AA section.

Constraints discovered (now in Lessons Learned above):
- Test counts go stale fast; pre-commit freshness audit is required.
- Documents need TOC + blockquote metadata + Mermaid + decision log to match project norm.

---
