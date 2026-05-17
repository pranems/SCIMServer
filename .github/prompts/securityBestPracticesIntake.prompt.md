---
name: securityBestPracticesIntake
description: Meta prompt - intake the latest security best-practices changes from standards bodies, frameworks, supply-chain registries, cloud platforms, and AI/LLM security communities. Sibling to gateStrategySelfAudit; lives in Stage M.2 and runs on the same 4-trigger cadence.
argument-hint: Optional - "--scope=quick" (top-3 categories only), "--scope=full" (all 10), "--scope=category:<name>" (one of: standards|protocol|supplyChain|crypto|container|cicd|web|privacy|cloud|llm). Default is "--scope=full".
---

This is a META prompt. It does not gate any commit. It does not run per-feature. It runs on inflection points (Stage M) to intake security best-practices changes from outside the repo, identify gaps in our gate suite, and propose concrete additions.

Sibling to `gateStrategySelfAudit` (M.1): both run on the same 4-trigger cadence; both produce structured reports under `docs/strategy/`. They differ in subject:
- **M.1 `gateStrategySelfAudit`** — internal drift + general external standards + incident learnings.
- **M.2 `securityBestPracticesIntake`** (this prompt) — security-specific external intake across 10 categories, with explicit cross-reference to our existing security gates.

The strict separation lets each prompt go deeper in its lane without bloating the other.

---

## Why a dedicated security intake prompt

Security best practices change faster than RFC errata or framework releases. Three recent examples:
- **OAuth 2.1 deprecated the implicit flow** — anyone still using it ships a known vulnerability.
- **xz-utils supply-chain attack (CVE-2024-3094)** — a single compromised dep auto-elevated to RCE in millions of systems.
- **npm package protestware** — maintainers can push malicious updates inside a patch-level bump.

Per-commit gates (`securityAudit`, `dependencyCveSweep`) cannot anticipate any of these. They check "is our code/deps healthy NOW vs the known threat landscape." They cannot ask "what NEW threats / mitigations emerged since last run."

This prompt is that proactive scan. Cost: 30-90 minutes per run. ROI breaks even at 1 supply-chain or auth-class incident avoided per N runs (real-world hit rate from comparable projects suggests N ≈ 6-12).

---

## Hard constraints (must follow)

1. **URL citation MANDATORY** for every external claim. No URL = output is tagged `"SPECULATIVE — verify before action"`. This is the strongest defense against the LLM inventing advisories.
2. **Confidence levels mandatory** per finding (`Critical` / `High` / `Medium` / `Speculative`).
3. **Owner action mandatory** — every finding lists what to do, by when, and which gate/code it affects.
4. **Tool-dependent gates flagged DEFERRED** if the tool isn't installed. Do not recommend a gate that the runner can't execute today.
5. **CVE-overlap rule** — if a finding is purely a CVE in our dep list, defer to `dependencyCveSweep`. Do not duplicate per-CVE analysis here.
6. **AI-specific findings tagged `[LLM]`** — they have different action paths from traditional security findings.

---

## Trigger conditions (same as M.1)

| Trigger | Cadence | Recommended scope |
|---|---|---|
| Release cuts | Every `v0.X.0` stable rollup | `--scope=full` |
| Calendar | Monthly (1st of month) | `--scope=full` |
| On-demand | User invokes | operator-specified |
| Incident-driven | After any security incident or near-miss | `--scope=category:<area>` |

---

## Category 1 - Standards bodies

Check since last run:
- **OWASP Top 10** ([owasp.org/Top10](https://owasp.org/Top10/)) - any category reshuffle, new entries (e.g., A10:2021 SSRF), or sunset entries?
- **OWASP API Security Top 10** ([owasp.org/API-Security](https://owasp.org/API-Security/)) - 2023 revision changed several categories.
- **OWASP LLM Top 10** ([genai.owasp.org](https://genai.owasp.org/)) - growing category; check LLM01 (Prompt Injection), LLM02 (Insecure Output Handling), LLM03 (Training Data Poisoning), LLM06 (Sensitive Info Disclosure).
- **CWE Top 25** ([cwe.mitre.org/top25](https://cwe.mitre.org/top25/)) - annual reshuffle reflects which CWEs are currently dominant in real CVEs.
- **NIST SP 800-series** (esp. 800-63 for digital identity, 800-204 for microservices, 800-218 SSDF) - revision notices on [csrc.nist.gov](https://csrc.nist.gov/publications/sp).
- **CIS Benchmarks** for Node.js, Docker, Linux, Azure - check the CIS site for revision dates.

For each change found, cross-reference: does our code or test suite cover the new/changed area?

---

## Category 2 - Protocol-level

- **OAuth 2.1** ([datatracker.ietf.org/doc/draft-ietf-oauth-v2-1](https://datatracker.ietf.org/doc/draft-ietf-oauth-v2-1/)) - finalized? deprecated implicit flow + ROPC are now widely held to be insecure. Our OAuth 2.0 client should be reviewed.
- **OAuth 2.0 Security Best Current Practice** (RFC 9700, Apr 2025) - mandatory reading for any OAuth implementation; check our `OAuthClientCredentials` flow against it.
- **OIDC FAPI 2.0** ([openid.net/specs/fapi-2_0-baseline](https://openid.net/specs/fapi-2_0-baseline-01.html)) - if we ever support FAPI-grade IdPs.
- **DPoP** (RFC 9449) - sender-constrained tokens; would tighten our bearer-token model.
- **SCIM RFC 7644 §7** errata - security considerations for SCIM specifically.
- **TLS 1.3 / TLS 1.2 deprecation** - any new advisories on TLS 1.0/1.1/SSLv3 forbidden in our infra?

---

## Category 3 - Supply chain

- **SLSA** ([slsa.dev](https://slsa.dev/)) - levels 1-4; check which level our build attests to. Currently: level 0 (no provenance).
- **npm provenance** ([docs.npmjs.com/generating-provenance-statements](https://docs.npmjs.com/generating-provenance-statements)) - publishing with provenance shows the chain from commit -> built package.
- **Sigstore / cosign** ([sigstore.dev](https://sigstore.dev/)) - image signing without long-lived keys via OIDC.
- **OpenSSF Scorecard** ([securityscorecards.dev](https://securityscorecards.dev/)) - run against our repo; lower scores are real risks.
- **GitHub Action SHA pinning** vs tag pinning - any new GHA supply-chain incidents (tj-actions/changed-files compromise, March 2025)?
- **Lockfile lifecycle** - `npm ci --audit-signatures` for signature verification on install.
- **typosquatting / dependency confusion** - any new patterns published by Snyk / Socket / GitHub Security blog?

For each: does our build / publish flow adopt it?

---

## Category 4 - Cryptographic deprecations

- **Hash algorithms** - SHA-1 deprecated for signatures (NIST SP 800-131A); MD5 should not appear anywhere; check for any usage.
- **Symmetric ciphers** - 3DES forbidden post-2023; AES-128 minimum; check our JWT signing alg + bcrypt rounds.
- **Asymmetric** - RSA-1024 forbidden; ECC curves: prefer P-256/P-384; Ed25519 increasingly preferred.
- **TLS versions** - TLS 1.0/1.1 forbidden; TLS 1.2 cipher hygiene; TLS 1.3 default by 2026.
- **Bcrypt rounds** - cost 10 was OK in 2010, 12 is current floor, 14 is conservative for new code.
- **JWT alg=none** - never accept; verify our JWT validator rejects.
- **JWT alg confusion** - HMAC vs RSA mixing; verify our code pins one alg.

---

## Category 5 - Container / runtime

- **Distroless base images** ([github.com/GoogleContainerTools/distroless](https://github.com/GoogleContainerTools/distroless)) vs our current node:25-alpine.
- **Rootless containers** - run as non-root UID; our `Dockerfile` should set `USER scim` after `RUN useradd`.
- **Image scanning** - trivy ([github.com/aquasecurity/trivy](https://github.com/aquasecurity/trivy)) for OS-level CVEs in the base image; grype as alternative.
- **SBOM generation** - syft ([github.com/anchore/syft](https://github.com/anchore/syft)) generates SBOMs at build time; SBOMs enable post-deploy CVE lookup.
- **Image signing** - cosign with keyless OIDC; verifies image came from our CI.
- **Runtime policies** - gVisor / Kata / AppArmor profiles for additional isolation.
- **Read-only root filesystem** - container should have `readOnlyRootFilesystem: true` in Kubernetes / Container Apps equivalent.
- **Capability drop** - `--cap-drop ALL` then add back only what's needed.

For each: does our `Dockerfile` / `docker-compose.yml` / `infra/containerapp.bicep` adopt the practice? Flag gaps.

---

## Category 6 - CI/CD security

- **Branch protection** - PR review required, status checks required, signed commits required, no force-push.
- **OIDC for cloud** - GitHub Actions -> Azure via `azure/login@v2` with OIDC, NOT long-lived service-principal secrets.
- **GHA permissions** - explicit `permissions:` block per workflow (default is too broad).
- **GHA action pinning** - `actions/checkout@<SHA>` not `@v4` (tags can be rewritten); use [stepsecurity.io](https://app.stepsecurity.io/) to audit.
- **Secret rotation** - SCIM_SHARED_SECRET, JWT_SECRET, OAUTH_CLIENT_SECRET — when last rotated?
- **CODEOWNERS** - sensitive paths (`api/src/security/`, `infra/`) require explicit reviewer.
- **Signed commits** - `git config commit.gpgsign true`; verifies commit authorship.
- **Dependabot / Renovate** - automated CVE-driven dep upgrades. Currently NOT configured.

---

## Category 7 - Web / UI security

- **CSP** (Content-Security-Policy) - the dev/prod responses should set a strict CSP. Currently: none on our SCIM API responses.
- **HSTS** (Strict-Transport-Security) - `max-age=31536000; includeSubDomains; preload`.
- **X-Frame-Options: DENY** or CSP `frame-ancestors 'none'`.
- **X-Content-Type-Options: nosniff**.
- **Referrer-Policy: strict-origin-when-cross-origin**.
- **Permissions-Policy** - minimize browser capabilities (camera, microphone, etc.).
- **COOP / COEP** - Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy for cross-origin isolation.
- **Trusted Types** ([w3c.github.io/trusted-types](https://w3c.github.io/trusted-types/dist/spec/)) - blocks DOM XSS by-design.
- **SRI** (Subresource Integrity) - any external script tags use `integrity="sha384-..."`.
- **CORS hardening** - the standing rule notes our CORS is permissive; tighten.

For each: does our `api/src/main.ts` middleware + `web/index.html` set the header?

---

## Category 8 - Privacy / PII

- **GDPR** - data subject rights (access, erasure, portability); our `/Me` endpoint covers access; what about erasure for soft-deleted users?
- **CCPA / CPRA** - California-specific; opt-out signal handling.
- **PIPL** - China-specific; if any China-targeted deployments, data localization matters.
- **PII logging** - `logging-verification` covers this; intake checks if any new categories of PII are defined (e.g. EU AI Act 2024 added "automated decision-making" as a special category).
- **Data minimization** - new push to remove fields that aren't strictly needed; e.g. do we log email addresses in request bodies?
- **Encryption at rest** - Postgres data + Container Apps storage; verify both encrypted.
- **Encryption in transit** - all inter-service comms over TLS.

---

## Category 9 - Cloud-specific (Azure)

- **Azure Security Baselines** ([learn.microsoft.com/security/benchmark/azure](https://learn.microsoft.com/security/benchmark/azure/)) - current versions; we should map our Container Apps deployment to it.
- **Managed Identity** vs service principal secrets - prefer Managed Identity for Azure-to-Azure calls.
- **Container Apps egress restrictions** - lock down outbound traffic to known endpoints only.
- **Azure WAF / Front Door** - if exposed publicly, WAF should sit in front.
- **Key Vault** - rotation policies; access policies; audit log retention.
- **Microsoft Defender for Cloud** - alerts on misconfigurations; check current status.
- **Azure Container Registry** - immutable tags, content trust, vulnerability scanning enabled.

---

## Category 10 - AI / LLM-specific (this category was added in the May 2026 expansion)

`[LLM]` prefix on all findings in this category.

- **OWASP LLM Top 10 2024** ([genai.owasp.org/llm-top-10](https://genai.owasp.org/llm-top-10/)):
  - **LLM01 Prompt Injection** - SCIM payloads from external IdPs are user-controlled; if we ever feed them to an LLM (e.g. AI-assisted log analysis), they're an injection vector.
  - **LLM02 Insecure Output Handling** - LLM output rendered without sanitization in the UI = XSS.
  - **LLM03 Training Data Poisoning** - irrelevant to us currently; we don't fine-tune.
  - **LLM06 Sensitive Information Disclosure** - LLMs may regurgitate API keys / PII; redact before sending context.
- **Prompt template hardening** - if we embed user data in prompts (we don't today, but Phase N could), use structured input boundaries.
- **Tool/function-calling permissions** - if any LLM in our chain can call a function, the function's effect must be authorized.
- **Model supply chain** - if we use Hugging Face / open-weights models, the model itself is a supply-chain artifact; check provenance.
- **Copilot / IDE-side risk** - the AI assistant writing this prompt is itself an attack surface; never let it auto-execute destructive commands.

---

## Step 1 - Run the categories

For each category in scope (default all 10):
1. Open the cited URLs and find: items dated AFTER the last `SECURITY_INTAKE_*.md` report under `docs/strategy/`.
2. For each new item, write a finding row.
3. Cross-reference: which existing gate (Stage X.Y) covers this? If none, propose a new gate.

---

## Step 2 - Produce findings table

| Category | Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|---|
| 5 Container | Trivy now FOSS gold standard for image CVE scan; not in our pipeline | https://github.com/aquasecurity/trivy | High | High | None | Add Stage 4.x trivy gate; track in Standing Backlog |
| 6 CI/CD | GHA action `tj-actions/changed-files` compromised Mar 2025 | https://github.com/blog/... | Critical | High | None today | Audit our GHA action pins; add pinning rule |
| 10 LLM | OWASP LLM Top 10 v2024 published | https://genai.owasp.org/llm-top-10 | Medium | High | None | Note in Standing Backlog; relevant when Phase N+ adds LLM-assisted features |
| ... | ... | ... | ... | ... | ... | ... |

---

## Step 3 - Produce gap-closure recommendations

Aggregate Step 2 into a recommendation list with cost vs value:

| Recommendation | Stage proposed | Tool / cost | Value | Defer reason (if any) |
|---|---|---|---|---|
| Add trivy container scan in Stage 4 | 4.2.1 | Install trivy ($0, 5 min); +60s per build | Catches OS-level CVEs in base image; HIGH value | None - recommend adding next sprint |
| Add `semgrep` SAST in Stage 1 | 1.10 | Install semgrep ($0); +30s per commit; ~20% false positive rate | Catches common bug patterns; MEDIUM value | Tune rule pack first |
| Add web security headers gate in Stage 5 | 5.5 | New Playwright spec; no new tool | Locks CSP/HSTS/etc.; HIGH value | None - add now |
| Configure Dependabot weekly | 6 | GitHub native ($0) | Surfaces dep upgrades automatically | Add this sprint |
| Pin all GHA actions to SHAs | 6 | Manual sweep + StepSecurity audit | Prevents tag-rewrite attacks | Add this sprint |

---

## Step 4 - Output structured report

Produce a Markdown report under `docs/strategy/SECURITY_INTAKE_<YYYY-MM-DD>.md` with:

1. **Summary** - run date, scope, # findings by severity, # accepted recommendations.
2. **Sections 1-10** - per-category findings (Step 2 table per section).
3. **Recommendations** - the Step 3 table.
4. **Linkage** - cross-references to existing gates that this intake confirms or amends.
5. **Next intake date** - usually 30 days out.

---

## Step 5 - Propose copilot-instructions.md deltas

Always include a final section "Proposed deltas to copilot-instructions.md" with concrete patches:
- New gates to add to the relevant stage.
- Standing Backlog entries to remove (if a recommendation was actioned).
- New Standing Backlog entries to add.
- Updates to the Cross-Cutting Security Map (see standing rules).

The operator reviews and decides whether to apply.

---

## Outputs

1. `docs/strategy/SECURITY_INTAKE_<date>.md` structured report.
2. Proposed copilot-instructions.md patches.
3. List of new Standing Backlog entries.
4. Confidence-tagged severity summary at the top.

---

## When NOT to run this prompt

- **DO NOT** run per-commit. Cost too high; intake-overhead disproportionate to per-commit risk.
- **DO NOT** invent advisories without URLs. Always cite source. Mark uncited claims `SPECULATIVE`.
- **DO NOT** recommend tooling the project can't realistically adopt this quarter. Push to Standing Backlog instead.
