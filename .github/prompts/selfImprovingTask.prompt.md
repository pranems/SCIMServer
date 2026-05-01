---
name: selfImprovingTask
description: Execute any task with a built-in self-evaluation, gap-analysis, and memory-update loop so each invocation makes the next one better.
argument-hint: The task to perform (e.g. "add unit tests for X", "audit docs", "design feature Y"). Free-form.
---

# Self-Improving Task Prompt

> **Intent.** Run the user's task, then **score the result against a rubric**, surface gaps, and **persist learnings to a memory file** so subsequent invocations of *any* task are stronger. Inspired by `docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md` Section 24 (Prompt Chain Methodology) - constraints, bias-removal phrases, hallucination detection, quality gates.

---

## How To Invoke

```
/selfImprovingTask <free-form task description>
```

Examples:
- `/selfImprovingTask add e2e tests for the new returned-attribute filter`
- `/selfImprovingTask refactor StatsProjectionService for testability`
- `/selfImprovingTask write the migration plan from InMemory to Prisma`

---

## Mandatory Execution Loop

The agent MUST execute these steps **in order**, in a single response, and never skip a step. Do not announce tool names; do the work.

### Step 0 - Load Memory (every run, no exceptions)

1. Read [.github/prompts/.memory/selfImprovingTask.memory.md](.github/prompts/.memory/selfImprovingTask.memory.md). If the file does not exist, create it from the seed template at the bottom of this prompt.
2. Treat the **Lessons Learned**, **Anti-Patterns Hit**, and **Heuristics That Worked** sections as binding constraints for this run.
3. Read `Session_starter.md` and `docs/CONTEXT_INSTRUCTIONS.md` for current project state (test counts, version, endpoint count).

### Step 1 - Restate & Decompose the Task

1. Restate the user's task in one sentence.
2. Decompose into 3-7 concrete subtasks, each with an explicit **success criterion** (a testable outcome, not a vibe).
3. Identify the **constraint** for this task: what is the single thing that, if violated, makes the output worthless? (e.g. "must compile", "must not break existing tests", "must not introduce em-dash characters").
4. Surface the **strongest argument against** the obvious approach and pick a path that survives the counter-argument.

### Step 2 - Apply Bias-Removal Phrases

Before executing, internally answer at least three of these (output the answers in a short bulleted block titled `Bias Check`):

- "If I started this from scratch with no prior context, what would I do differently?"
- "What is the strongest argument against my current plan?"
- "What would a senior reviewer flag immediately?"
- "What's the smallest version of this that proves the approach?"
- "Which of my claims here lack a verifiable source?"

### Step 3 - Execute the Task

Do the work. Edit files, run commands, write tests - whatever the task requires. Follow the project's standing rules:

- **NEVER** use em-dash characters (Unicode `U+2014`) anywhere - always use a single hyphen `-` instead. This applies to code, comments, strings, docs, commit messages, and any generated content. Verify with `Select-String -Pattern ([char]0x2014)`.
- **NEVER** use `git commit --amend` unless the user explicitly asks.
- Always use `git add -A; git commit -m "..."` to save progress.
- Match existing code conventions discovered in Step 0.
- For features/bug-fixes that ship code, follow the **Feature / Bug-Fix Commit Checklist** in `.github/copilot-instructions.md` (unit tests + e2e + live-test.ps1 section + dedicated doc + INDEX.md update + CHANGELOG.md + Session_starter.md update + version bump + response-contract tests).

### Step 4 - Self-Evaluation Against Rubric

After execution, score your own output across this rubric. Output a markdown table titled `Self-Evaluation`. Be honest; a low score with a recovery plan is better than an inflated score.

| Dimension | Score (1-5) | Evidence | Improvement |
|---|---|---|---|
| Correctness (does it work / compile / pass tests) | | | |
| Constraint adherence (Step 1's single constraint) | | | |
| Project conventions (em-dash, commit style, file linking, response-key allowlist) | | | |
| Test coverage (unit + e2e + live where applicable) | | | |
| Documentation freshness (INDEX, CHANGELOG, Session_starter, doc page) | | | |
| Hallucination check (every API / library / version cited is real) | | | |
| Multi-mode safety (works in InMemory + Prisma + Docker + Standalone + Azure) | | | |
| Reversibility (can this be cleanly rolled back) | | | |

A score of `<= 3` on any row REQUIRES a follow-up action listed in Step 5.

### Step 5 - Gap Analysis (Senior Reviewer Mode)

Run this checklist against the output. For each gap, either fix it now or list it under `Deferred Work` with a concrete next step:

- [ ] All new/changed routes have unit + e2e + live coverage
- [ ] Response shape is asserted with a key allowlist (`expect(ALLOWED_KEYS).toContain(key)`), not just `toHaveProperty`
- [ ] Internal runtime fields prefixed with `_` are filtered before serialization
- [ ] Logs do not leak PII or tokens
- [ ] Errors propagate as proper SCIM error responses (not 500 leaks)
- [ ] Public types in `api/src/shared/types/*` are the single source of truth (no parallel definitions)
- [ ] Files referenced in the response use markdown links per `fileLinkification` rules
- [ ] No em-dash characters anywhere in the diff (`git diff | Select-String -Pattern '\u2014'` returns nothing)
- [ ] `package.json` version was bumped if behavior changed
- [ ] `CHANGELOG.md` has an entry with full test counts and feature summary
- [ ] `docs/INDEX.md` lists any new doc page
- [ ] `Session_starter.md` "Update Log" appended with a `| Date | Summary |` row

### Step 6 - Update Memory (mandatory write-back)

Append to [.github/prompts/.memory/selfImprovingTask.memory.md](.github/prompts/.memory/selfImprovingTask.memory.md):

1. **Run header**: date, task summary (one line), final self-evaluation average score.
2. **What worked**: 1-3 heuristics that produced high-scoring rows. Promote any that worked twice into the `Heuristics That Worked` section at the top of the memory file.
3. **What failed**: 1-3 failures with root cause and the fix. Promote repeats into `Anti-Patterns Hit`.
4. **New constraint discovered** (optional): if the task surfaced a project rule not yet codified anywhere, add it under `Lessons Learned` and recommend (in chat output, not silently) that the user copy it into `.github/copilot-instructions.md`.
5. **Prompt evolution proposal** (optional): if a better wording for any step in this prompt would have prevented a failure, write the proposed diff under `Prompt Evolution Proposals` with reasoning. Do not edit this prompt file silently; surface the proposal so the user can approve.

### Step 7 - Final Output To User

End the response with these four blocks, in this order:

1. **Summary**: 2-4 sentences of what was done.
2. **Self-Evaluation**: the rubric table from Step 4.
3. **Deferred Work**: bulleted list, each item linked to a file using markdown links.
4. **Memory Updated**: one-line confirmation of what was appended to the memory file, plus any prompt-evolution proposals awaiting user approval.

---

## Quality Gates (must all be true before ending the response)

Refuse to end the turn until every gate passes. If a gate fails, loop back to Step 3.

- [ ] Memory file was read at the start AND appended at the end
- [ ] Self-Evaluation table was produced with honest scores (no row blank, no row hand-waved)
- [ ] Gap-analysis checklist was run; every unchecked item appears in `Deferred Work`
- [ ] No em-dash characters introduced (verify with grep)
- [ ] All file references use the `[path](path#Lline)` markdown link format
- [ ] If code was written: it compiles, tests pass, and lint is clean (or failures are explicitly listed)
- [ ] If a doc was written: it has the project's blockquote metadata header and TOC
- [ ] If a feature/bug-fix was committed: the Feature/Bug-Fix Commit Checklist from `.github/copilot-instructions.md` is satisfied (or each missing item is in `Deferred Work` with a reason)

---

## Anti-Patterns This Prompt Refuses

- **Skipping Step 0** - "I already know this project" is the path to repeated mistakes. Always read memory.
- **Inflating self-scores** - A 5/5 on every row with no evidence column is a fail.
- **Silent prompt edits** - Improvements to this prompt are *proposed*, never written without user approval.
- **Memory-without-promotion** - Single-event observations stay in run logs; only repeat patterns get promoted to top-of-file sections.
- **Decision-by-default** - Picking the first plausible approach without surfacing the strongest counter-argument (Step 1.4).
- **Hand-waving numbers** - "Roughly 100ms", "should be fine", "probably works" are all rejected. Either measure or mark as estimate with derivation.

---

## Memory File Seed (created on first run if absent)

If [.github/prompts/.memory/selfImprovingTask.memory.md](.github/prompts/.memory/selfImprovingTask.memory.md) does not exist, create it with exactly this content:

```markdown
# Self-Improving Task Memory

> Persistent learnings across runs of `selfImprovingTask`. Read at the start of every run; appended at the end of every run. Patterns observed twice are promoted from per-run logs into the top sections.

## Heuristics That Worked

(empty - populated as repeat-successful patterns emerge)

## Anti-Patterns Hit

(empty - populated as repeat-failure patterns emerge)

## Lessons Learned (Project Constraints Discovered)

- Project forbids em-dash characters in any file (see `.github/copilot-instructions.md`).
- Response contracts must use key allowlist assertions, not just `toHaveProperty`.
- Internal fields prefixed with `_` must never appear in API responses.
- Features require unit + e2e + live tests + dedicated doc + INDEX.md + CHANGELOG.md + Session_starter.md updates.

## Prompt Evolution Proposals

(empty - any user-approved proposals are merged into the prompt file directly)

## Run Log

(append new runs below; oldest first)

---
```

After seeding, immediately proceed with Step 1 of the loop.

---

## Why This Prompt Improves Itself

Three mechanisms compound across runs:

1. **Memory accumulation** - Each run appends to a file the next run reads. Repeated heuristics get promoted; repeated failures become anti-patterns. Knowledge survives context resets.
2. **Rubric stress-testing** - The Self-Evaluation rubric forces the agent to find its own weaknesses. Patterns of low scores on a row (e.g. always weak on multi-mode safety) become Lessons Learned.
3. **Prompt evolution** - When a wording in this prompt fails to prevent a known failure, the run proposes an explicit diff. The user reviews and merges, so the prompt itself gets sharper without uncontrolled drift.

The prompt is therefore three artifacts cooperating: this file (the *contract*), the memory file (the *experience*), and the user (the *editor*). The agent is constrained by all three.
