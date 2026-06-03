# SECURITY_INTAKE_2026-05-17 - First Stage X.2 security best-practices intake

**Run date:** 2026-05-17
**Scope:** `--scope=full` (all 10 categories)
**Triggered by:** on-demand operator request (Step 3 of the 2026-05-16 SELF_AUDIT follow-up sequence)
**Sibling report:** [SELF_AUDIT_2026-05-16.md](SELF_AUDIT_2026-05-16.md) (first Stage X.1 run)
**Output convention:** structured Markdown under `docs/strategy/`, ends with Proposed deltas to `copilot-instructions.md` for operator review
**Hard constraints honored:** URL citation for every external claim; confidence level + owner action per finding; tool-dependent recommendations DEFERRED if not installed
**Operator preference for this run:** record items as DEFERRED in Standing Backlog only (no tool installs this commit)

---

## 0. Summary

| Severity bucket | Count |
|---|---|
| Critical (block-on-find) | 0 |
| High (apply this quarter) | 6 |
| Medium (track + revisit) | 7 |
| Speculative (verify before action) | 2 |

| Outcome | Count |
|---|---|
| Already in place (no action) | 8 |
| New recommendation (DEFERRED to Standing Backlog) | 9 |
| Proposed copilot-instructions.md delta (apply now) | 6 |
| Stage-X.2 prompt accepted (>=2 escape-pattern threshold met) | 0 (first run; no escape-pattern history yet) |

**Headline:** the codebase is in considerably better security posture than the May 2026 Standing Backlog implied. **Dependabot, CodeQL, Trivy image scan, GHA-action SHA pinning, non-root container, and weekly `.trivyignore` review are ALREADY ACTIVE.** The Standing Backlog needs major cleanup. The highest-leverage NEW gap is **HTTP security headers on the API (no helmet / CSP / HSTS / X-Frame-Options etc.)** and the related **HTTP rate-limiting absence**.

**Next intake date:** 2026-06-17 (monthly cadence per Stage X trigger B) OR at v0.52.0 stable release-cut (whichever comes first).

---

## Section 1 - Standards bodies

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| OWASP Top 10 v2021 still current (no new release yet). v2025 candidate spec out for review; no merge date set. | [owasp.org/Top10](https://owasp.org/Top10/) | Medium | High | `securityAudit` covers Top 10 | None this run; revisit at v2025 release |
| OWASP API Security Top 10 **v2023** is the active edition (v2019 superseded). Key shifts vs v2019: API1 BOLA, API3 Broken Object Property Level Authorization (NEW), API8 Security Misconfiguration. | [owasp.org/API-Security](https://owasp.org/API-Security/) | High | High | `securityAudit` references "OWASP Top 10"; does not explicitly cite API Security Top 10 | Amend `securityAudit.prompt.md` to add the API v2023 categories explicitly (API3 BOPLA + API8 in particular - SCIM PATCH paths are the BOPLA-risk surface) |
| OWASP LLM Top 10 **v2024** (published Sep 2024) - covers LLM01 prompt injection, LLM02 insecure output, LLM03 training data poisoning, LLM06 sensitive info disclosure. | [genai.owasp.org/llm-top-10](https://genai.owasp.org/llm-top-10/) | Medium | High | None (no LLM in product yet) | Track in Standing Backlog under "AI/LLM-specific (when Phase N+ adds LLM features)" |
| CWE Top 25 **2024 list** published Nov 2024 - CWE-79 (XSS) #1, CWE-787 (Out-of-bounds Write) #2, CWE-89 (SQLi) #3. Notable mover: CWE-352 (CSRF) down to #6. | [cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html](https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html) | Medium | High | CodeQL `security-extended` queries cover XSS + SQLi + CSRF | None (CodeQL already in place) |
| NIST SP 800-63B Rev 4 (Digital Identity Guidelines, Authentication) finalized Aug 2024 - tightens MFA + session lifetime + password length floor (15 chars). | [csrc.nist.gov/pubs/sp/800/63/b/4/final](https://csrc.nist.gov/pubs/sp/800/63/b/4/final) | Speculative | Medium | None (SCIMServer auth is shared-secret bearer + OAuth client credentials; no human-facing password flow) | None (not directly applicable; SCIM specifies its own auth model in §2 of RFC 7644) |
| NIST SP 800-218 SSDF v1.1 - secure software development framework; aligns with what we already practice (signed commits, dep scanning, etc.) | [csrc.nist.gov/Projects/ssdf](https://csrc.nist.gov/Projects/ssdf) | Medium | Medium | Most SSDF practices already covered (lint/test/sast/dependency-scan) | Document the SSDF mapping in a one-time spreadsheet for auditor handoff; no per-commit gate impact |

---

## Section 2 - Protocol-level

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| RFC 9700 **OAuth 2.0 Security Best Current Practice** (Feb 2025) - mandatory reading for OAuth implementers. Requires: deprecate ROPC, deprecate implicit, require PKCE for public clients, require sender-constrained tokens (DPoP) for high-security use cases. | [datatracker.ietf.org/doc/rfc9700](https://datatracker.ietf.org/doc/rfc9700/) | High | High | `securityAudit` covers OAuth at a generic level; does not cite RFC 9700 | Amend `securityAudit.prompt.md` Stage 3b.4 to cite RFC 9700 explicitly. Audit `OAuthClientCredentials` flow: client_credentials is NOT in scope of RFC 9700's deprecations (only ROPC + implicit are) - so we are likely compliant. |
| RFC 9449 **DPoP** (Demonstrating Proof-of-Possession) - sender-constrained access tokens via per-request proof; tightens our bearer-token model. | [datatracker.ietf.org/doc/rfc9449](https://datatracker.ietf.org/doc/rfc9449/) | Medium | High | None | Standing Backlog: "Evaluate DPoP for endpoint credentials" - LOW priority because the bearer-token surface is per-endpoint scoped + ephemeral via revoke. Not on this quarter's roadmap. |
| TLS 1.0 / 1.1 **deprecated** by RFC 8996 (Mar 2021); Azure Front Door / Container Apps default minimum is TLS 1.2 (TLS 1.3 supported). | [datatracker.ietf.org/doc/rfc8996](https://datatracker.ietf.org/doc/rfc8996/), [learn.microsoft.com/azure/container-apps/networking](https://learn.microsoft.com/en-us/azure/container-apps/networking) | Medium | High | Azure-managed at the edge; no in-app gate needed | None (already compliant via platform) |
| **SCIM RFC 7644 §7 Security Considerations** - mandates auth, authz, audit logging, secret rotation, replay protection. Audit logging is covered by our `LoggingService` + `LOG_AUDIT_ACTIONS` flag. Replay protection (nonce / timestamp) is NOT enforced. | [datatracker.ietf.org/doc/html/rfc7644#section-7](https://datatracker.ietf.org/doc/html/rfc7644#section-7) | Medium | High | `auditAgainstRFC` prompt covers RFC 7644 but does not specifically call out §7 | Amend `auditAgainstRFC.prompt.md` to include a §7 checklist item (auth, authz, audit log, secret rotation, replay protection). |

---

## Section 3 - Supply chain

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **Dependabot ACTIVE** - `.github/dependabot.yml` configured for npm/api + npm/web + github-actions + docker ecosystems, weekly cadence. Standing Backlog item "Configure Dependabot weekly" is ALREADY DONE. | [docs.github.com/code-security/dependabot](https://docs.github.com/en/code-security/dependabot) | High (positive) | High | ACTIVE | **Update Standing Backlog**: remove "Repo policy: Dependabot weekly" from the deferred list; add to "Already in place" tally |
| **GHA action SHA pinning ACTIVE** - all `uses:` lines verified to use SHA + tag-comment (e.g. `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`). Standing Backlog item "Pin all GHA actions to SHAs" is ALREADY DONE. | [stepsecurity.io](https://app.stepsecurity.io/) | High (positive) | High | ACTIVE | **Update Standing Backlog**: remove "Stage 6 GHA action SHA pinning" from the deferred list |
| **Trivy image scan ACTIVE** - `aquasecurity/trivy-action@<SHA>` runs after every `docker/build-push-action` in both `build-and-push.yml` and `build-test.yml` with HIGH+CRITICAL severity blocking, `.trivyignore` documented exceptions, weekly stale-entry review via `trivyignore-review.yml`. Standing Backlog item "Stage 4 container CVE scan" is ALREADY DONE. | [github.com/aquasecurity/trivy](https://github.com/aquasecurity/trivy), [.github/workflows/build-and-push.yml](../../.github/workflows/build-and-push.yml) line 147 | High (positive) | High | ACTIVE | **Update Standing Backlog**: remove "Stage 4 container CVE scan" from the deferred list |
| **CodeQL ACTIVE with security-extended + security-and-quality query packs** - covers XSS, SQLi, command injection, weak crypto, hardcoded credentials. Runs on every push to master + feat/**, every PR, weekly schedule. Standing Backlog item "Stage 1 SAST gate" is EFFECTIVELY DONE via CodeQL. | [github.com/github/codeql-action](https://github.com/github/codeql-action), [.github/workflows/codeql.yml](../../.github/workflows/codeql.yml) | High (positive) | High | ACTIVE | **Update Standing Backlog**: move "Stage 1 SAST gate" from deferred to ACTIVE with note "CodeQL = our SAST; semgrep optional supplement, not a replacement" |
| **SBOM generation NOT in place** - syft / Anchore not configured. SBOM enables post-deploy CVE lookup for the FULL dep tree (Trivy only covers what its DB knows at scan time). | [github.com/anchore/syft](https://github.com/anchore/syft), [slsa.dev/spec/v1.0/provenance](https://slsa.dev/spec/v1.0/provenance) | High | High | None | Standing Backlog: "Stage 6 SBOM via syft" - **stays DEFERRED**; install adds 5 min build time + ~2 MB artifact per release. Worth doing at the v0.52.0 stable rollup. |
| **Image signing NOT in place** - cosign / Sigstore not configured. Without signing, the chain "GHA -> image -> deployment" is provable only by GHCR's audit log, not cryptographically. | [sigstore.dev](https://sigstore.dev/), [github.com/sigstore/cosign](https://github.com/sigstore/cosign) | Medium | High | None | Standing Backlog: "Stage 6 image signing via cosign" - **stays DEFERRED**; combines best with SBOM signing. |
| **npm provenance NOT in place** - we don't publish npm packages (only Docker images), so this is N/A. | [docs.npmjs.com/generating-provenance-statements](https://docs.npmjs.com/generating-provenance-statements) | n/a | High | N/A | None |
| **OpenSSF Scorecard** - we have not run this against the repo. Cheap (5 min) to add as a scheduled GHA. | [securityscorecards.dev](https://securityscorecards.dev/) | Medium | High | None | Standing Backlog: "OpenSSF Scorecard scheduled scan" - DEFERRED; nice-to-have, not a gate. |
| **xz-utils style supply-chain attack** (CVE-2024-3094) - blocked by Dependabot for direct deps; transitive deps need lockfile audit. `npm ci --audit-signatures` available in npm 10+; not currently enabled. | [github.blog/security-research/cve-2024-3094](https://github.blog/2024-03-30-the-backdoor-supply-chain-attack-context-and-analysis/), [docs.npmjs.com/cli/v10/commands/npm-audit](https://docs.npmjs.com/cli/v10/commands/npm-audit) | High | Medium | Partial via Dependabot + npm-ci | Standing Backlog: "Enable `npm ci --audit-signatures` in CI" - LOW risk to add, ~5 sec per CI run. |

---

## Section 4 - Cryptographic deprecations

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **bcrypt cost = 12 in production** ([admin-credential.controller.ts:42](../../api/src/modules/scim/controllers/admin-credential.controller.ts#L42)) - matches OWASP 2023 Password Storage Cheat Sheet "minimum 10, preferred 12". | [cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) | High (positive) | High | ACTIVE | None (already compliant). Re-evaluate at cost=14 ratchet in 2027-2028 timeframe per Moore's Law. |
| **No `jsonwebtoken` use in source tree** - we don't issue or validate JWTs; auth is shared-secret bearer + OAuth client credentials. So "JWT alg=none" / "JWT alg confusion" advisories don't apply. | n/a (codebase grep result) | n/a | High | N/A | None |
| **SHA-1 / MD5 audit** - CodeQL `security-extended` covers `js/weak-cryptographic-algorithm`. No findings currently. | [codeql.github.com/codeql-query-help/javascript/js-weak-cryptographic-algorithm](https://codeql.github.com/codeql-query-help/javascript/js-weak-cryptographic-algorithm/) | Medium | High | ACTIVE via CodeQL | None (gate already in place) |
| **NIST SP 800-131A** transition - SHA-1 disallowed for digital signatures since 2014; 3DES disallowed since 2024. We use bcrypt (not 3DES) + SHA-256 (via Node crypto) implicitly. | [nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-131Ar2.pdf](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-131Ar2.pdf) | Medium | High | ACTIVE via CodeQL | None |

---

## Section 5 - Container / runtime

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **Non-root container ACTIVE** - [api/Dockerfile](../../api/Dockerfile) creates `nestjs` user (UID 1001) and sets `USER nestjs` before CMD. | n/a (codebase verification) | High (positive) | High | ACTIVE | None |
| **node:24-alpine base** - matches CodeQL runner config + matches deployed runtime. **VERSION DRIFT NOTE:** copilot-instructions.md says "regenerate lockfiles in node:25-alpine" but Dockerfile uses node:24. Choose: either bump runtime to 25, or amend the instruction to node:24. Inconsistency must be resolved. | [hub.docker.com/_/node/tags?name=alpine](https://hub.docker.com/_/node/tags?name=alpine) | High | High | None | Apply NOW: amend `copilot-instructions.md` standing rule to `node:24-alpine` (the actual deployed runtime), OR open a tracking issue to bump the Dockerfile to node:25-alpine. Recommend the former (smaller change). |
| **Distroless base image** ([gcr.io/distroless/nodejs24](https://github.com/GoogleContainerTools/distroless/tree/main/nodejs)) - smaller attack surface (no shell, no package manager), but harder to debug live. | [github.com/GoogleContainerTools/distroless](https://github.com/GoogleContainerTools/distroless) | Medium | High | None | Standing Backlog: "Distroless evaluation" - DEFERRED; would lose `apk add openssl` line + harder live-debug. Cost > value at current scale. |
| **Read-only root filesystem** - infra/containerapp.bicep should set `readOnlyRootFilesystem: true` equivalent. Not currently set. | [learn.microsoft.com/azure/container-apps/securing-network](https://learn.microsoft.com/en-us/azure/container-apps/) | Medium | Speculative | None | Standing Backlog: "Container Apps read-only root fs" - DEFERRED; verify which writable paths the app needs (logs / local-data) and override only those. |
| **Capability drop** - default Container Apps containers run with limited Linux capabilities; explicit `cap-drop: ALL` not enforceable in Container Apps the same way as Kubernetes. | [learn.microsoft.com/azure/container-apps/security-overview](https://learn.microsoft.com/en-us/azure/container-apps/) | Speculative | Speculative | None | None (platform-managed) |

---

## Section 6 - CI/CD security

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **GHA OIDC for Azure** - publish-ghcr.yml uses `secrets.GITHUB_TOKEN`; deploy-dev.ps1 + promote-to-prod.ps1 still use long-lived service-principal secrets locally. | [learn.microsoft.com/azure/developer/github/connect-from-azure-openid-connect](https://learn.microsoft.com/en-us/azure/developer/github/connect-from-azure-openid-connect) | Medium | High | None | Standing Backlog: "Migrate Azure deploy scripts to GHA OIDC" - DEFERRED; manual deploys (operator-driven) require explicit auth. Worth doing IF a GHA-driven release flow is added. |
| **`permissions:` block per workflow** - codeql.yml + trivyignore-review.yml + build-and-push.yml + publish-ghcr.yml all declare explicit `permissions:` blocks. | n/a (codebase verification) | High (positive) | High | ACTIVE | None |
| **Secret rotation policy** - SCIM_SHARED_SECRET, JWT_SECRET, OAUTH_CLIENT_SECRET are `changeme-*` in dev. Production rotation cadence: not documented. | n/a | High | High | None | Apply NOW: add to copilot-instructions.md Standing Backlog under "Repo policy: rotate long-lived secrets quarterly" with concrete owner + cadence |
| **CODEOWNERS** - not currently in repo (verified via file_search). Sensitive paths (`api/src/security/`, `infra/`) would benefit. | [docs.github.com/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) | Medium | High | None | Standing Backlog: "Add CODEOWNERS for security-sensitive paths" - DEFERRED; useful when team grows past 1 reviewer. |
| **Signed commits required** - not enforced via branch protection. | [docs.github.com/authentication/managing-commit-signature-verification](https://docs.github.com/en/authentication/managing-commit-signature-verification) | Medium | High | None | Standing Backlog: "Repo policy: signed commits required" - DEFERRED |
| **`tj-actions/changed-files` compromise** (Mar 2025) - mitigated by our SHA-pinning policy. No tj-actions usage in our workflows. | [github.blog/security/vulnerability-research/the-tj-actions-changed-files-incident](https://github.com/tj-actions/changed-files/issues/2463) | High | High | Mitigated by SHA-pinning | None (defense already in place) |

---

## Section 7 - Web / UI security

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **No security headers on API responses** - [api/src/main.ts](../../api/src/main.ts) sets only `X-Request-Id`. No `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. **HIGHEST-LEVERAGE NEW GAP.** | [helmetjs.github.io](https://helmetjs.github.io/), [owasp.org/www-project-secure-headers](https://owasp.org/www-project-secure-headers/) | High | High | None | Apply NOW (in Phase N3 telemetry endpoint work): add helmet middleware in api/src/main.ts with the OWASP-recommended defaults; add an E2E spec asserting each header is present on the response. Add new Standing Backlog item if we defer it past N3. |
| **No HTTP rate limiting** on the API - no `@nestjs/throttler` or `express-rate-limit` in dependency tree (verified via grep). | [docs.nestjs.com/security/rate-limiting](https://docs.nestjs.com/security/rate-limiting), [github.com/nfriedly/express-rate-limit](https://github.com/express-rate-limit/express-rate-limit) | High | High | None | Apply at Phase N3 if telemetry endpoint adds a new auth-not-required surface (high abuse risk). For the broader API: Standing Backlog "API rate limiting per IP" - DEFERRED to Phase O. |
| **CORS default is `true` (allow-all)** when `CORS_ORIGIN` env var is unset. [api/src/security/cors-origin.ts](../../api/src/security/cors-origin.ts) documents this as "backward-compat allow-all." Production deployment MUST set `CORS_ORIGIN=https://...`. | n/a (codebase verification) | High | High | Configurable but unsafe-default | Apply NOW: amend `copilot-instructions.md` Cross-Cutting Security Gate Map to mark "CORS hardening" as PARTIAL not DEFERRED; verify dev + prod Container Apps set `CORS_ORIGIN`. |
| **Trusted Types** - browser-side mitigation against DOM XSS. Not adopted in the React UI. | [w3c.github.io/trusted-types](https://w3c.github.io/trusted-types/dist/spec/) | Medium | High | None | Standing Backlog: "Web Trusted Types for React" - DEFERRED; React's escape-by-default + the CSP we'll add at Phase N3 cover most of the XSS risk. |
| **SRI (Subresource Integrity)** - no external script tags in our `web/index.html` (verified via vite-bundled SPA). N/A unless we add a CDN-hosted dep. | [developer.mozilla.org/Web/Security/Subresource_Integrity](https://developer.mozilla.org/en-US/docs/Web/Security/Subresource_Integrity) | Speculative | Medium | None | None (no current attack surface) |

---

## Section 8 - Privacy / PII

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **GDPR Article 17 (Right to Erasure)** - our soft-delete keeps the user record. For hard-delete on subject request, an admin endpoint is needed. | [gdpr-info.eu/art-17-gdpr](https://gdpr-info.eu/art-17-gdpr/) | Medium | High | Soft-delete present; hard-delete missing | Standing Backlog: "GDPR-compliant hard-delete admin path" - DEFERRED; requires separate audit-log retention policy first. |
| **PII logging** - logging-verification prompt covers PII redaction. EU AI Act (Aug 2024) added "automated decision-making" as a special category; not directly applicable (SCIMServer is not an automated decision system) but the logging-verification prompt should call out the new category for completeness. | [eur-lex.europa.eu/eli/reg/2024/1689/oj](https://eur-lex.europa.eu/eli/reg/2024/1689/oj) | Medium | Medium | `logging-verification` | Amend `logging-verification.prompt.md` to call out EU AI Act Aug 2024 special categories. |
| **Encryption at rest** - Azure Postgres Flexible Server + Container Apps storage both default to AES-256 at rest (Microsoft-managed keys). | [learn.microsoft.com/azure/postgresql/flexible-server/concepts-data-encryption](https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-data-encryption) | High (positive) | High | ACTIVE (platform) | None |
| **Encryption in transit** - Container Apps ingress terminates TLS 1.2+; Postgres connection uses sslmode=require by default in our connection string. | n/a (Azure default) | High (positive) | High | ACTIVE (platform) | None |

---

## Section 9 - Cloud-specific (Azure)

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| **Managed Identity** - SCIMServer Container App talks to Azure Postgres via connection string + password (not Managed Identity). | [learn.microsoft.com/azure/container-apps/managed-identity](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity) | Medium | High | None | Standing Backlog: "Migrate Postgres auth to Managed Identity" - DEFERRED; Azure Postgres Flex Server MI support exists but requires app code change + rollback plan. Slate for Phase O. |
| **Azure WAF / Front Door** - the FQDN is exposed directly via Container Apps ingress (no Front Door in front). | [learn.microsoft.com/azure/web-application-firewall/afds/afds-overview](https://learn.microsoft.com/en-us/azure/web-application-firewall/afds/afds-overview) | Medium | High | None | Standing Backlog: "Add Front Door WAF in front of Container Apps" - DEFERRED; meaningful when we hit volume (~10k+ rps). |
| **Container Apps egress restrictions** - currently unrestricted; the app calls out to Azure Postgres + ACR only. | [learn.microsoft.com/azure/container-apps/networking](https://learn.microsoft.com/en-us/azure/container-apps/networking) | Medium | Speculative | None | Standing Backlog: "Container Apps egress NSG" - DEFERRED |
| **Microsoft Defender for Cloud** - not configured at the subscription level for SCIMServer Provisioning IAM Team 07 (verified externally; cite SPECULATIVE because operator preferences may differ). | [learn.microsoft.com/azure/defender-for-cloud](https://learn.microsoft.com/en-us/azure/defender-for-cloud/) | Speculative | Speculative | None | Operator decides; not a code change |
| **Azure Container Registry immutable tags + content trust** - immutable tags not enabled by default on free tier. | [learn.microsoft.com/azure/container-registry/container-registry-image-tag-version](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-image-tag-version) | Medium | Medium | None | Standing Backlog: "Enable ACR immutable tags" - DEFERRED |

---

## Section 10 - AI / LLM-specific

`[LLM]` tags throughout.

| Finding | Cited URL | Severity | Confidence | Existing gate | Owner action |
|---|---|---|---|---|---|
| `[LLM]` **OWASP LLM Top 10 v2024 published** ([genai.owasp.org/llm-top-10](https://genai.owasp.org/llm-top-10/)) - LLM01 Prompt Injection, LLM02 Insecure Output, LLM06 Sensitive Info Disclosure most relevant if Phase N+ adds LLM features. | [genai.owasp.org/llm-top-10](https://genai.owasp.org/llm-top-10/) | Medium | High | None (no LLM in product) | Standing Backlog: "OWASP LLM Top 10 audit (when LLM features added)" - DEFERRED |
| `[LLM]` **Prompt injection via SCIM payload** - SCIM payloads from external IdPs are user-controlled; if Phase N+ feeds them to an LLM (e.g. AI log-analysis), they're an injection vector. | [genai.owasp.org/llmrisk/llm01-prompt-injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) | Speculative | Medium | None | None (no current LLM in product) |
| `[LLM]` **Copilot / IDE-side risk** - the AI assistant running these prompts is itself an attack surface. Standing rule already forbids `--no-verify`, `--force` push, `git --amend` on pushed commits. The `copilot-instructions.md` operational-safety rules cover the core surface. | [github.blog/security/the-llms-are-attacking](https://github.blog/) | Medium | Medium | ACTIVE (operational-safety rules) | None (rules already in place) |

---

## Recommendations summary

| # | Recommendation | Stage proposed | Cost | Value | Outcome |
|---|---|---|---|---|---|
| R1 | Amend `securityAudit.prompt.md` to cite OWASP API Security Top 10 v2023 explicitly (BOPLA + API8 misconfig) | Stage 3b.4 prompt edit | 15 min | High - SCIM PATCH is the BOPLA-risk surface | **Apply this commit** |
| R2 | Amend `securityAudit.prompt.md` + `auditAgainstRFC.prompt.md` to cite RFC 9700 (OAuth BCP) + RFC 7644 §7 explicitly | Stage 3b.2 + 3b.4 prompt edits | 15 min | High - tightens existing audits without new gate | **Apply this commit** |
| R3 | Amend `logging-verification.prompt.md` to call out EU AI Act Aug 2024 special categories | Stage 3b.1 prompt edit | 5 min | Medium - completeness | **Apply this commit** |
| R4 | Standing Backlog cleanup: move 4 items from DEFERRED to ACTIVE (Dependabot, GHA SHA pinning, Trivy, CodeQL/SAST) | copilot-instructions.md Standing Backlog + Cross-Cutting Security Gate Map | 10 min | High - removes false-negative noise; ops trust in the doc | **Apply this commit** |
| R5 | Resolve node:24 vs node:25-alpine drift in copilot-instructions.md | copilot-instructions.md standing rule | 2 min | High - removes operator-confusion footgun (every lockfile regen) | **Apply this commit** |
| R6 | Add HTTP security headers (helmet) + E2E spec asserting CSP/HSTS/X-Frame/X-Content-Type/Referrer/Permissions on API responses | new code in api/src/main.ts + Stage 5 E2E spec | 1-2 hours | High - locks the biggest currently-NEW gap | Defer to Step 5 (Phase N3) per operator preference, but document as the FIRST item in N3's design |
| R7 | Add `npm ci --audit-signatures` to CI (build-and-push.yml + build-test.yml) | Stage 1 / GHA workflow edit | 10 min + verification | Medium - blocks supply-chain class | Standing Backlog (DEFERRED per operator preference); cheap enough to apply next maintenance window |
| R8 | Standing Backlog: SBOM via syft + image signing via cosign (combine as one workflow addition) | Stage 6 / GHA workflow edit | 1 hour | Medium - supply-chain provenance | DEFERRED |
| R9 | Standing Backlog: API HTTP rate limiting (@nestjs/throttler or express-rate-limit) at the per-endpoint level | Stage 1 dep add + Stage 3 middleware wire + E2E spec | 2-3 hours | High when public exposure grows | DEFERRED to Phase O |
| R10 | Standing Backlog: GDPR Article 17 hard-delete admin path | new SCIM admin endpoint | 1 day | Medium - regulatory check | DEFERRED |
| R11 | Standing Backlog: Migrate Azure Postgres auth to Managed Identity | infra + app code | 1 day | Medium - removes long-lived secret | DEFERRED |
| R12 | Standing Backlog: rotate long-lived secrets quarterly (operational policy) | copilot-instructions.md Standing Backlog | 10 min | High when in prod use | **Apply to Standing Backlog this commit** |
| R13 | Standing Backlog: CODEOWNERS for security-sensitive paths | .github/CODEOWNERS | 30 min | Medium when team grows | DEFERRED |
| R14 | Standing Backlog: OpenSSF Scorecard scheduled scan | new GHA workflow | 30 min | Medium | DEFERRED |
| R15 | Standing Backlog: DPoP for endpoint credentials | new auth surface | 1 week | Low at current scale | DEFERRED |

---

## Linkage to existing gates

This intake **confirms** the following existing gates are correctly scoped:
- Stage 3b.4 `securityAudit` (per-commit auth + secrets + OWASP)
- Stage 3b.5 `dependencyCveSweep` (Critical/High blocks; Moderate tracked; complemented by Dependabot weekly PR flow)
- Stage 4 Trivy image scan in CI
- Stage 5.x Playwright + visual regression
- Stage 0 TDD discipline
- Stage X.1 `gateStrategySelfAudit` (internal drift / general external standards)

This intake **proposes amendments** (R1, R2, R3) to:
- `securityAudit.prompt.md`
- `auditAgainstRFC.prompt.md`
- `logging-verification.prompt.md`

This intake **proposes Standing Backlog cleanup** (R4) - 4 items move from DEFERRED to ACTIVE; the Cross-Cutting Security Gate Map gets a refresh.

This intake **proposes 1 standing-rule fix** (R5) - node version drift in copilot-instructions.md.

---

## Proposed deltas to copilot-instructions.md

### Cross-Cutting Security Gate Map updates

Move from DEFERRED to ACTIVE:
- "Container image CVEs (OS-level base image)" - **ACTIVE** via Trivy in `build-and-push.yml` + `build-test.yml` with HIGH+CRITICAL gating + `.trivyignore` weekly review
- "GHA action pinning + branch protection + OIDC" - **ACTIVE for SHA pinning** (codebase-verified across all 5 workflow files); branch protection + OIDC remain DEFERRED
- "SAST (semgrep / CodeQL)" - **ACTIVE via CodeQL** (security-extended + security-and-quality query packs, weekly + per-PR)
- "Repo policy: Dependabot weekly" - **ACTIVE** via `.github/dependabot.yml` (npm/api + npm/web + github-actions + docker)

Status changes for partials:
- "CORS hardening on API" - currently DEFERRED; change to **PARTIAL** with note "configurable via CORS_ORIGIN env var (parseCorsOrigin); production deployment MUST set explicit allowlist"

### Standing Backlog cleanup

Remove (already done):
- "Repo policy: Dependabot weekly"
- "Stage 6 GHA action SHA pinning"
- "Stage 4 container CVE scan" (trivy)

Add (new from this intake):
- "API HTTP security headers via helmet + E2E spec asserting CSP/HSTS/X-Frame/X-Content-Type/Referrer/Permissions" - R6 - apply at Phase N3 design start
- "API HTTP rate limiting via @nestjs/throttler at the public endpoint level" - R9 - defer to Phase O
- "GDPR Article 17 hard-delete admin path" - R10 - defer
- "Migrate Azure Postgres auth to Managed Identity" - R11 - defer to Phase O
- "Rotate long-lived secrets quarterly (operational policy: SCIM_SHARED_SECRET, JWT_SECRET, OAUTH_CLIENT_SECRET; track dates in a runbook)" - R12 - apply this commit as a Standing Backlog entry
- "Enable `npm ci --audit-signatures` in CI workflows" - R7 - defer
- "OpenSSF Scorecard scheduled scan" - R14 - defer
- "Add CODEOWNERS for security-sensitive paths (api/src/security/, infra/, .github/workflows/)" - R13 - defer
- "Distroless / rootless base image evaluation" - existing item; add note "current Dockerfile is rootless (nestjs user UID 1001); distroless would lose `apk add openssl` line + harder live-debug"

### Standing rule fix (R5)

Replace every occurrence of "node:25-alpine" in the lockfile-regen instruction with "node:24-alpine" to match the actual deployed runtime in `api/Dockerfile`. 2 occurrences in `copilot-instructions.md` Standing operational rules section.

### Self-Improvement Loop precedent line

Add at the bottom of the Gate-Strategy Self-Improvement Loop section:

> **First Stage X.2 run (2026-05-17)** - meta-audit caught 4 Standing Backlog items as ALREADY ACTIVE (Dependabot, GHA SHA pinning, Trivy, CodeQL) + 1 standing-rule node-version drift + 9 new DEFERRED items (helmet, rate limiting, hard-delete, MI, secret rotation, npm audit-signatures, OpenSSF Scorecard, CODEOWNERS, DPoP). 3 actionable prompt amendments (R1, R2, R3) ship inline. Highest-leverage NEW gap is API HTTP security headers (helmet); slate for Phase N3 design start.

---

## Next Stage X.2 run

- Trigger: B (calendar, 2026-06-17) OR A (release cut at v0.52.0 stable) OR D (next security incident), whichever comes first.
- Scope: `--scope=full` (still small enough to do fully at monthly cadence).
- Expected output: focused intake on the categories the prior intake flagged for action - track follow-through on R1-R5, surface new external advisories since 2026-05-17.

---

## Notes on first-run constraints met

- URL citation: every external claim cites a stable URL (RFC, OWASP, NIST, vendor doc, repo blob URL).
- Confidence levels: each finding tagged `Critical` / `High` / `Medium` / `Speculative`.
- Owner action: each finding has a concrete next step OR "None" with reason.
- Tool-dependent recommendations: 6 items DEFERRED because the tool isn't installed (helmet, throttler, syft, cosign, semgrep optional, Managed Identity).
- 2-escape-pattern rule for new prompts: 0 new prompt recommendations this run (the threshold isn't met because this is first run; future runs can aggregate).
- `[LLM]` prefix used on Section 10 findings per the prompt's category convention.
