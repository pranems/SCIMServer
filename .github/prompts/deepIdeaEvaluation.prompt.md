---
name: deepIdeaEvaluation
description: Deeply evaluate a proposed idea from all perspectives with research, explanatory artifacts, and self-improving feedback.
argument-hint: A short description of the idea, concept, or proposal to evaluate (and optionally the target codebase/domain context).
---
I have an idea I want you to evaluate rigorously. Think deeply, research broadly, and respond with a structured, evidence-backed assessment that follows our project norms. This prompt is **self-improving**: at the end you will critique the prompt itself and propose concrete edits.

**The idea:** {the idea, concept, or proposal to evaluate}

---

## Operating principles (read first)

- **Be a critic, not a cheerleader.** Default stance is skeptical. If the idea is weak, say so plainly with reasons.
- **Disagree explicitly** with the user when evidence supports it. Hedging is failure.
- **Evidence over opinion.** Every claim should cite code (file + symbol), a doc, an RFC, a measurement, or a named pattern. Mark anything else as "assumption" or "intuition".
- **Calibrate confidence.** Attach a confidence level (Low / Medium / High) to non-trivial claims and to the final verdict. State what would move the dial.
- **Steelman before attacking.** Present the strongest version of the idea before critiquing it.
- **Search before speculating.** If the workspace or external sources can answer a question, look it up; do not guess.
- **No fabrication.** If a fact, file, API, or quote is not verified, label it as unverified or omit it.

---

## Step 0 - Plan and clarify

1. Restate the idea in your own words.
2. List assumptions you are making and ambiguities you are resolving.
3. Ask **only blocking** clarifying questions (max 3). If none are blocking, proceed and document the chosen interpretation.
4. Define **success criteria**: what would make this idea objectively "good" vs. "bad" in this codebase / domain? Each criterion MUST be a measurable target (number, percentage, or pass/fail predicate). Reject prose-only criteria.

## Step 1 - Research the context

Before forming an opinion, gather evidence:

- **Workspace scan**: related code, prior decisions, session memory, docs, changelog, tests. Cite files and symbols.
- **External sources**: specs, RFCs, vendor docs, well-known references via available MCP servers / documentation tools when relevant. Cite what you used.
- **Prior art**: similar features, patterns, libraries, or industry standards. Note who solved this before and how.
- **Constraints**: existing architectural decisions, performance budgets, compliance requirements, deployment topology.

State explicitly what you searched for and what you found vs. did not find.

## Step 2 - Multi-perspective analysis

Evaluate the idea through each lens. For each lens give a 1-line verdict (Pro / Con / Neutral) plus a short justification:

- Functional / user value and jobs-to-be-done
- Architecture and design fit (coupling, cohesion, layering, separation of concerns, blast radius)
- Standards / RFC / spec / contract compliance
- Security, privacy, and threat model (STRIDE-style: spoofing, tampering, repudiation, info disclosure, DoS, elevation). If the feature fetches user-supplied URLs or stores third-party credentials, run an SSRF + credential-handling sub-checklist: DNS rebind, RFC1918/loopback blocking, redaction in logs, explicit consent strings, never persist secrets.
- Performance, scalability, and cost (asymptotic and concrete)
- Reliability, observability, and operability (failure modes, SLOs, telemetry, runbooks)
- Testability and quality gates (unit, e2e, live, contract, property-based where relevant)
- Developer experience and maintainability (cognitive load, churn cost, onboarding)
- Backward compatibility, migration risk, and deprecation path
- Ethics, accessibility, and inclusivity (where applicable)
- Total cost of ownership over a realistic horizon

## Step 3 - Trade-off table

Compare at least 2-3 viable approaches (including the proposed idea and the "do nothing" baseline) across the lenses above. Use a Markdown table. End with a recommendation and clear reasoning.

## Step 4 - Explanatory artifacts

Use whichever apply; do not pad:

- **Mermaid** diagrams (architecture / sequence / state / flow / C4 context as appropriate)
- **Contract sketches** (types, schemas, request/response shapes, error model)
- **Pseudocode** or minimal code skeleton for the critical path, in the project's primary language
- **Worked example** showing input -> behavior -> output, including at least one edge case
- **KaTeX** for quantitative reasoning (latency, complexity, capacity, error budgets)
- **Decision record** snippet (ADR-style: context, decision, consequences) if the idea is architectural

## Step 5 - Risks, unknowns, and failure modes

- Top risks ranked by (likelihood x impact), each with a concrete mitigation.
- Pre-mortem: imagine it failed in production 6 months in - what is the most plausible story?
- Unknowns and how to cheaply de-risk them (spike, prototype, benchmark, user test).
- Reversibility: is this a one-way door or a two-way door? What is the rollback plan?

## Step 6 - Verdict

- **Stance**: Adopt / Adopt-with-changes / Defer / Reject.
- **Top 3 reasons** for the stance.
- **Confidence**: Low / Medium / High, with what evidence would change it.
- **Counter-position**: the strongest argument *against* your stance, and why you still hold it.
- **Top "I might be wrong about" item**: lift the single weakest claim from Step 8 self-critique into the verdict so the reader sees it without scrolling.

## Step 7 - Actionable next steps (only if Adopt or Adopt-with-changes)

- Incremental delivery plan: small, independently testable increments with clear exit criteria.
- Required tests per project norms (unit, e2e, live integration, contract, performance).
- Documentation updates (feature doc, index, changelog, session/context files).
- Quality gates to run before "done".
- Telemetry and rollout plan (feature flag, canary, dashboards, alerts).
- Suggested owner / reviewer profile and rough effort estimate (T-shirt size + range).

## Step 8 - Self-critique and prompt improvement (always run)

After producing the answer, critique **both** the answer and **this prompt**:

1. **Answer self-review**:
   - What did I likely get wrong or under-research? Flag it.
   - Where is my confidence weakest? What single experiment would resolve it?
   - Did I steelman before critiquing? Did I disagree where warranted?
   - Did every non-trivial claim have evidence or an "assumption" label?

2. **Prompt self-improvement** (the self-improving loop):
   - Identify 1-3 concrete weaknesses in this prompt as it was applied to this idea (e.g., missing lens, unclear step, redundant section, wrong default).
   - Propose precise edits as a unified diff or "Replace X with Y" instructions targeting this prompt file.
   - If the improvements are clearly beneficial and low-risk, apply them to the prompt file directly and note what changed and why. Otherwise, present the proposed edits for the user to approve.
   - Keep a short **Changelog** section at the bottom of the prompt file (date + 1-line summary) so improvements compound over time.

---

## Constraints and style

- Follow the workspace's established conventions and standing rules (no em-dashes; use the project's file-link format; KaTeX for math; Mermaid for diagrams; respect character and commit rules from `copilot-instructions.md`).
- Be direct and decisive; surface disagreement explicitly rather than hedging.
- Prefer concrete, file- and symbol-level references over generic advice.
- Keep prose tight; lean on tables, diagrams, and lists for density.
- If the idea is bad, recommend rejecting it and explain why, with the same rigor as recommending it.

## Output skeleton (use these headings)

1. Restatement, assumptions, clarifying questions, success criteria
2. Research summary (workspace + external + prior art)
3. Multi-perspective analysis
4. Trade-off table and recommendation
5. Explanatory artifacts (diagrams, contracts, pseudocode, worked example, math)
6. Risks, pre-mortem, reversibility
7. Verdict (stance, top 3 reasons, confidence, counter-position)
8. Next steps (only if adopting)
9. Self-critique and prompt improvement

---

## Changelog (this prompt)

- 2026-05-06: Initial version. Added self-improving step, calibrated confidence, steelman-before-attack, pre-mortem, reversibility, ADR snippet, and explicit success-criteria step.
- 2026-05-06: Self-improvement pass after "SCIM clone" idea. Added measurable-criteria rule (Step 0), SSRF/credential sub-checklist in security lens (Step 2), and "I might be wrong about" callout in verdict (Step 6).
