---
name: promptChainArchitecture
description: Run a 12-stage architecture decision pipeline (competitive scan -> direction -> perf -> solutions -> unconstrained R1/R2 -> testability -> automation -> multi-env -> sequencing -> documentation -> gap-filling) with built-in self-improvement and per-run memory.
argument-hint: A short description of the architectural decision to investigate (e.g. "redesign the admin UI", "introduce event sourcing for stats", "split the monolith into BFF + core").
---

# Prompt Chain Architecture (Self-Improving)

> **Source.** Operationalizes Section 24 of [docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md](../../docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md) - the Prompt Chain Methodology that produced that document. Each invocation is a full 12-stage run with explicit constraints, quality gates, and a memory file that survives across runs so the methodology gets sharper every time.

> **Three artifacts cooperate.** This prompt file is the **contract** (how stages run). The memory file [.github/prompts/.memory/promptChainArchitecture.memory.md](.memory/promptChainArchitecture.memory.md) is the **experience** (what worked and what failed across runs). The user is the **editor** who approves promotions of repeat patterns into the contract. The agent is constrained by all three.

---

## How To Invoke

```
/promptChainArchitecture <one-line description of the decision to investigate>
```

Examples:
- `/promptChainArchitecture redesign the admin UI`
- `/promptChainArchitecture introduce event sourcing for stats projection`
- `/promptChainArchitecture migrate from REST to gRPC for internal calls`

The output of every successful run is a single RFC-style markdown document under `docs/<TOPIC>_ARCHITECTURE_AND_PLAN.md` plus an updated memory file.

---

## Stage Taxonomy (binding contract)

Every run executes these 12 stages **in order**. Each stage has a single value-creating **constraint** - the thing it forbids. Removing the constraint collapses the stage into the previous one and the run is invalid.

| # | Stage | Constraint | Artifact | Validated By |
|---|---|---|---|---|
| 1 | Competitive scan | Forbid mentioning current implementation | Verdict table of >= 8 products | Stages 7, 9 |
| 2 | Direction crystallization | Forbid "we'll figure it out later" | Concrete tech stack + phase outline | Stages 3, 10 |
| 3 | Performance impact | Forbid hand-waving (numbers required) | Bottleneck list with metrics | Stage 4 |
| 4 | Solution design | Each solution maps to a Stage-3 metric | Architectural changes mapped to bottlenecks | Stages 7, 8 |
| 5 | Unconstrained R1 | Forbid using only the original tech stack | >= 3 ideas not in initial plan | Stage 6 |
| 6 | Unconstrained R2 | Forbid using ANY prior context (company, audience, stack) | First-principles alternatives | Stage 11 |
| 7 | Testability | Every component has a defined test boundary | 4-tier test pyramid mapping | Stage 8 |
| 8 | Automation | Forbid quality gates that need humans | Zero-human CI pipeline with budgets | Stage 10 |
| 9 | Multi-environment | Forbid coupling to one deployment mode | [Component x Mode] matrix | Stage 10 |
| 10 | Sequencing | Forbid steps without explicit dependencies | DAG of <= 1-day steps | Stage 11 |
| 11 | Formal documentation | Forbid undocumented decisions | RFC-style doc with decision log | Stage 12 |
| 12 | Gap filling | Forbid skipping the "what's missing" question | Senior-reviewer gap analysis | Memory file |

**Back-validation rule.** If a later stage's constraint cannot be satisfied because of a decision in an earlier stage, return to that earlier stage and revise. Do not paper over the conflict.

---

## Mandatory Execution Loop

Run these meta-steps every invocation. Do not skip Step 0 or Step 13. Do not announce tool names; do the work.

### Step 0 - Load Memory and Project Context

1. Read [.github/prompts/.memory/promptChainArchitecture.memory.md](.memory/promptChainArchitecture.memory.md). If it does not exist, create it from the seed at the bottom of this prompt.
2. Read `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `docs/INDEX.md` for current state (test counts, version, endpoint count, doc conventions).
3. Treat the memory file's `Heuristics That Worked`, `Anti-Patterns Hit`, and `Lessons Learned` sections as binding constraints for this run.

### Steps 1 through 12 - Execute the Pipeline

For each stage, in order:

1. **Re-state the constraint** for the stage in one sentence.
2. **Apply the bias-removal phrase** appropriate to the stage (see table below).
3. **Produce the artifact** the stage demands. Use the per-stage prompt template (see below) - parameterize with project context.
4. **Run the per-stage quality gate** (see table below). If the gate fails, loop within the stage until it passes; do not advance.
5. **Synthesize a <= 200-word context block** capturing the stage's output. This block - not the verbose deliberation - is what carries forward.
6. **Update a working draft** of the final document with the stage's section. The document IS the persistent context; the conversation is not.

### Step 13 - Finalize and Update Memory

1. Stage 11 already produced the document; verify it has TOC, blockquote metadata header, Mermaid diagrams, decision log with Verdict + Alternatives, multi-mode matrix, file inventory, day-by-day plan.
2. Run the **End-of-Run Quality Gates** (below). Refuse to end the turn until all pass.
3. Append a run log entry to the memory file (run header, stage scores, what worked, what failed, prompt-evolution proposals).
4. Promote any pattern observed twice across runs from the run log into the top sections (`Heuristics That Worked`, `Anti-Patterns Hit`, `Lessons Learned`).
5. If a wording in this prompt failed to prevent a known failure, surface a `Prompt Evolution Proposal` in the chat output (do not edit this prompt silently).
6. Output the final summary blocks (see `Final Output Format`).

---

## Per-Stage Prompt Templates

Substitute `{{project}}`, `{{domain}}`, `{{current_stack}}`, `{{audience}}`, `{{constraints}}`, `{{modes}}`, `{{ci_budget_minutes}}`, `{{current_year}}` from project context discovered in Step 0.

### Stage 1 - Competitive Scan

```text
Ignore everything {{project}} currently does. Research >= 8 leading products
in the {{domain}} space. For each, extract: dominant UI metaphor, primary
navigation pattern, density choice, notable interaction, one unique design
principle. Produce a verdict table:
[Product | Metaphor | Best Idea | Adopt? Yes/No/Adapt | Reasoning].
Conclude with 3-5 distinct synthesis options. Do NOT reference
{{current_stack}} or audience expectations yet.
```

### Stage 2 - Direction Crystallization

```text
From the Stage-1 options, pick a concrete direction. State:
- Primary architectural metaphor
- Tech stack (frameworks, libraries, versions - all current major)
- Phase outline (Phase 0 foundation -> Phase N cutover)
- Single sentence describing the user-facing experience that distinguishes it
Forbidden: "we'll figure it out later", "TBD", any unversioned dependency.
```

### Stage 3 - Performance Impact Analysis

```text
For every change in Stage 2, quantify:
- Database queries per request (count, type)
- p50/p95 latency (estimate or measured)
- Bundle size delta (KB gzipped)
- Memory footprint (heap, MB)
- Network round trips per user action
Identify all N+1 risks, count(*) storms, synchronous filesystem reads,
unbounded loops. Provide a NUMBER for each. Hand-waving disqualifies a row.
```

### Stage 4 - Solution Design

```text
For each Stage-3 bottleneck, design >= 1 architectural change that
provably improves its metric. Map every solution to the metric it
addresses. Forbidden: solutions that don't trace to a Stage-3 metric.
```

### Stage 5 - Unconstrained Exploration R1

```text
Imagine the original tech stack does not exist. Propose >= 3 alternatives
not currently in the plan. Cite real products / papers / libraries for
each. Argue against the Stage-2 direction at least once.
```

### Stage 6 - Unconstrained Exploration R2

```text
Forget everything we've discussed. Pretend you have never seen this
codebase. You are designing this from scratch in {{current_year}} with
NO constraints: not bound to {{current_stack}}, not bound to {{audience}}'s
familiarity, not bound to existing infrastructure, not bound to team skills.
What would you choose? What would you NOT choose that I'm likely to assume?
Argue against my likely defaults. Cite specific products or papers.
```

### Stage 7 - Testability Validation

```text
For each component in the plan answer:
1. Test boundary (unit / integration / E2E / contract)?
2. What does it depend on, and how is the dependency mocked or stubbed?
3. Can it be tested without a network, a database, or a browser?
4. Smallest reproducer that exercises full behaviour?
Flag any component failing any of these. Propose a refactor that makes
it testable without changing its public contract.
```

### Stage 8 - Automation Validation

```text
Design a CI pipeline enforcing every quality gate without human review.
For each gate specify: tool, time budget (total < {{ci_budget_minutes}}),
failure mode (block / warn / auto-fix), coverage requirement.
List any gate currently relying on human judgment and replace it OR
explicitly accept the residual risk.
```

### Stage 9 - Multi-Environment Validation

```text
Modes the product must support: {{modes}}.
For each component, prove it works in every mode by either:
(a) showing it depends only on abstractions present in all modes, or
(b) providing a mode-specific adapter with a parity test.
Output a matrix [Component x Mode] with pass/fail and the test that proves it.
No "TBD" cells.
```

### Stage 10 - Implementation Sequencing

```text
Produce a DAG of steps. Each step:
- Takes <= 1 day for one engineer
- Lists explicit inputs (files/types it needs) and outputs (files/types created)
- Identifies upstream deps by step number
- Maps to a Decision Log entry
- Is independently testable
Group into phases. Identify the critical path. Flag any step that, if
slipped, blocks >= 3 downstream steps.
```

### Stage 11 - Formal Documentation

```text
Produce a single markdown document at docs/{{TOPIC}}_ARCHITECTURE_AND_PLAN.md
with: TOC, blockquote metadata header (status / owner / date / version /
related-rfcs), Mermaid diagrams (flowchart, sequenceDiagram, erDiagram
where applicable), decision log with Verdict + Alternatives + Rationale
columns, risk assessment, multi-mode matrix, file inventory,
day-by-day plan. Add an entry to docs/INDEX.md under the appropriate section.
```

### Stage 12 - Gap Filling

```text
Run the senior-reviewer checklist against the document. Add a section
or justify omission for each: accessibility (WCAG 2.1 AA, ARIA),
error handling (boundaries, optimistic rollback, status-code catalog),
security (CSP, PII, secrets, authn/authz), code splitting / lazy loading,
responsive / mobile, observability / telemetry (Web Vitals, error tracking),
internationalization, backward compatibility, migration path,
abandonment plan, on-call runbook, prompt-chain methodology used.
```

---

## Bias-Removal Phrases (the "unlock words")

Empirically effective. Use the matching phrase when its stage is active. Output the answer at the start of the stage in a `Bias Check` block.

| Stage | Phrase | Purpose |
|---|---|---|
| 1 | "Ignore what we currently have" | Prevents anchoring to existing implementation |
| 2 | "What is the strongest argument **against** this direction?" | Surfaces hidden risk |
| 3 | "Numbers required - hand-waving disqualifies" | Forces estimation discipline |
| 5 | "What would Linear / Stripe / Raycast do?" | Imports specific design vocabulary |
| 6 | "Forget everything we discussed" + "If I started from scratch in {{current_year}}" | Defeats path-dependence |
| 7 | "Can this be tested without a network / DB / browser?" | Forces honest test-boundary thinking |
| 8 | "Replace every human gate with an automated one or accept the risk explicitly" | No silent manual gates |
| 9 | "Does this work in every deployment mode?" | Prevents single-mode bias |
| 10 | "What blocks the most downstream steps if it slips?" | Surfaces critical path |
| 12 | "What would a senior reviewer flag?" | Triggers gap-finding mode |

---

## Hallucination Detection Checklist

Apply at the end of every stage that cites APIs, libraries, or numbers. If any check fails, fix and re-run the stage.

1. **Cite-check** - Every library/API claim has a verifiable URL (docs, GitHub, npm). Open one and confirm.
2. **Version-check** - Frameworks are current major (TanStack Query v5 not v3, React 19 not 17, NestJS 10+).
3. **Compile-check** - Generated TypeScript passes `tsc --noEmit` against the project's real tsconfig.
4. **Lint-check** - Code passes the project's actual ESLint rules.
5. **Cross-check** - Same question framed two ways. Compare answers; investigate discrepancies.
6. **Reverse-check** - Ask "what is wrong with this answer?". Strong agreement is a sycophancy red flag.
7. **Numeric sanity** - Round numbers (1000ms, 100KB) likely invented; demand a derivation.
8. **API existence** - For every non-trivial API call, search the actual library source / docs.

---

## Per-Stage Quality Gates

Advance only when the gate passes. If it fails, loop within the stage.

| Stage | Gate |
|---|---|
| 1, 5, 6 | >= 3 distinct alternatives evaluated; no "winner-takes-all" framing |
| 2 | Tech stack lists every framework with a current major version; no TBD |
| 3 | Every bottleneck has a numeric metric (queries, ms, KB, MB) |
| 4 | Every solution maps to >= 1 Stage-3 metric and improves it |
| 7 | Every component has a test boundary and a stub/mock plan |
| 8 | Every quality gate is automated; manual gates are explicit residual risk |
| 9 | [Component x Mode] matrix fully populated; no "TBD" cells |
| 10 | Every step is <= 1 day, has inputs/outputs, traces to a decision |
| 11 | Every decision has Rationale + Alternatives + Verdict |
| 12 | Gap checklist run; rejected gaps have written justification |

---

## End-of-Run Quality Gates (Step 13 refusal triggers)

Refuse to end the turn unless every gate passes. If a gate fails, loop back to the earliest failing stage.

- [ ] Memory file was read at Step 0 AND appended at Step 13
- [ ] All 12 stages executed in order; no stage skipped
- [ ] Every stage produced its artifact; every quality gate passed
- [ ] Final document exists at `docs/<TOPIC>_ARCHITECTURE_AND_PLAN.md`
- [ ] Document has TOC, blockquote metadata header, Mermaid diagrams, decision log, multi-mode matrix, file inventory, sequenced plan
- [ ] `docs/INDEX.md` updated with a link to the new doc
- [ ] No em-dash characters in any output (verify with `Select-String -Pattern ([char]0x2014)`)
- [ ] No `--amend` used; commits are additive
- [ ] All file references in chat output use `[path](path#Lline)` markdown link format
- [ ] Hallucination checklist applied to every stage that cited APIs / libraries / numbers
- [ ] Run log appended to memory file with honest per-stage scores

---

## Anti-Patterns This Prompt Refuses

- **Decision-by-default** - Accepting the first AI suggestion without surfacing >= 2 alternatives.
- **Premature commitment** - Locking in a tech stack before competitive research (Stage 1).
- **Single-source bias** - Researching only one product category.
- **Skipping unconstrained rounds** - Going from "current state" to "plan" without removing context (Stages 5 and 6).
- **Plan without risk assessment** - Listing tasks without listing what could go wrong.
- **Rationale-free decisions** - "We picked X" without "because Y, despite Z, instead of W".
- **Solo-mode validation** - Validating only against the favoured deployment mode.
- **Test-after-the-fact** - Defining tests after writing code instead of as part of the architecture.
- **Doc-as-afterthought** - Writing the design doc after implementation. The doc IS the design artifact.
- **Hand-waving numbers** - "Roughly 100ms", "should be fine" rejected. Either measure or mark as estimate with derivation.
- **Memory-skip** - "I already know this project" is the path to repeating mistakes. Always read memory.
- **Inflated self-scores** - Every stage 5/5 with no evidence is a fail.
- **Silent prompt edits** - Improvements to this prompt are *proposed*; the user merges.

---

## Subagent Delegation Strategy

| Task | Delegate to subagent | Do inline |
|---|---|---|
| Multi-file inventory across the repo | Yes | |
| Web research across 5+ URLs | Yes | |
| Parallel competitive analysis (Stage 1) | Yes | |
| Long-running test execution | Yes | |
| Architectural synthesis / decision-making | | Yes |
| Edits to the working codebase | | Yes |
| Final document assembly (Stage 11) | | Yes |
| User-facing communication | | Yes |

Rule: **delegate breadth, retain depth**. Subagents are stateless; the main agent owns synthesis, decisions, and writes.

---

## Context Window Management (>200K tokens)

1. **Persist decisions immediately** - Every approved decision goes into the working document so it survives a context reset.
2. **Synthesize at stage boundaries** - <= 200-word context block per stage; carry forward only the synthesis.
3. **Re-inject only the synthesis** when starting a new sub-conversation.
4. **Externalize reference data** - Long competitive matrices, RFC excerpts go into separate docs read on demand.
5. **The document is the persistent context.** Later stages append, not re-derive.

---

## Self-Improvement Mechanism

Three loops compound across runs.

**Loop 1 - Memory accumulation.** Step 0 reads the memory file; Step 13 appends to it. Single observations stay in the run log. Patterns observed twice get *promoted* to top-of-file sections (`Heuristics That Worked`, `Anti-Patterns Hit`, `Lessons Learned`). Knowledge survives context resets.

**Loop 2 - Per-stage scoring.** Step 13 records honest scores per stage. Patterns of low scores on a stage (e.g. always weak on Stage 3 numeric rigour) become Lessons Learned and tighten the per-stage template.

**Loop 3 - Prompt evolution.** When a wording in this prompt fails to prevent a known failure, the run proposes an explicit diff. The user reviews and merges. The contract sharpens without uncontrolled drift.

The agent is therefore constrained by three artifacts cooperating: this file, the memory file, and the user.

---

## Final Output Format (every run ends with these blocks, in order)

1. **Document Created** - Markdown link to the new `docs/<TOPIC>_ARCHITECTURE_AND_PLAN.md` with line count and section count.
2. **Stage Scorecard** - 12-row table: stage / constraint satisfied? (yes/no) / evidence / score (1-5).
3. **Decisions Logged** - Count of D-entries with Verdict + Alternatives.
4. **Multi-Mode Matrix** - Confirmation that no cell is TBD.
5. **Deferred Work** - Bullet list of items that didn't fit the run, each linked to a file.
6. **Memory Updated** - One-line confirmation of what was appended; any prompt-evolution proposals awaiting user approval.

---

## Memory File Seed (created on first run if absent)

If [.github/prompts/.memory/promptChainArchitecture.memory.md](.memory/promptChainArchitecture.memory.md) does not exist, create it with exactly this content:

```markdown
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

(append new runs below; oldest first)

---
```

After seeding, immediately proceed with Step 1 of the loop.

---

## Why This Prompt Improves Itself

Every run produces three durable artifacts:

1. **An RFC-style document** under `docs/` that captures the decision and survives the conversation.
2. **An updated memory file** that promotes repeat patterns and surfaces failure modes.
3. **An optional prompt-evolution proposal** that lets the contract itself sharpen under user review.

The model supplies breadth and recall; the operator supplies sequencing, refusal, and approval. Constraints create insight. Validation is structural. The document is the outcome.
