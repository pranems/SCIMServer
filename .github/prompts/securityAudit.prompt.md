---
name: securityAudit
description: Comprehensive security audit covering auth flows, secret management, input validation, PII exposure, and OWASP top-10 patterns.
argument-hint: Optional scope - "auth", "secrets", "input-validation", "pii", "headers", or "full" (default).
---

Perform a security audit of the SCIMServer codebase. This covers areas not handled by `error-handling-verification` (which audits error paths) or `auditAgainstRFC` (which audits RFC compliance).

---

## Audit Sections

### A. Authentication & Authorization

Check all auth mechanisms for correctness:

| # | Check | Files | Pass Criteria |
|---|-------|-------|---------------|
| A1 | Bearer token extraction is constant-time (`safeCompare`) | `api/src/security/safe-compare.ts`, all guards | No `===` on secrets; `timingSafeEqual` used |
| A2 | OAuth token endpoint validates client_secret | `api/src/modules/auth/oauth.controller.ts` | Rejects invalid client_id/client_secret with 401 |
| A3 | JWT signing uses HS256+ with env-sourced secret | `api/src/modules/auth/jwt.strategy.ts` | No hardcoded secrets in source |
| A4 | Per-endpoint credential hashing uses bcrypt/scrypt | `api/src/modules/endpoint/` | Plaintext never stored in DB |
| A5 | Admin endpoints require auth | All `admin.controller.ts` routes | Every route has a guard decorator |
| A6 | SCIM endpoints require auth | All SCIM controllers | Every route has `SharedSecretGuard` or equivalent |
| A7 | Auth bypass not possible via header manipulation | Guards | Case-insensitive header parsing, no fallback to anonymous |

### B. Secret Management

| # | Check | Files | Pass Criteria |
|---|-------|-------|---------------|
| B1 | No secrets in source code | `grep -r` across `api/src/` | Zero matches for passwords, tokens, keys in literals |
| B2 | No secrets in logs | Log service, request logger | Secrets redacted or never logged |
| B3 | `.env` files in `.gitignore` | `.gitignore` | `.env*` pattern present |
| B4 | State files don't contain production secrets in git | `scripts/state/*.json` | If secrets are present, file is in `.gitignore` or values are placeholders |
| B5 | Docker Compose doesn't hardcode prod secrets | `docker-compose.yml` | Uses env vars or defaults only for local dev |
| B6 | Container App secrets use `secretRef` not inline values | `infra/containerapp.bicep` | Secrets passed via parameters, not hardcoded |

### C. Input Validation & Injection

| # | Check | Files | Pass Criteria |
|---|-------|-------|---------------|
| C1 | SCIM filter parser rejects injection | `api/src/domain/filter/` | Non-string input rejected (S-6); length capped (DTO-1) |
| C2 | JSON body size limited | `api/src/main.ts` or NestJS config | Body parser has max size (default 100kb or explicit) |
| C3 | SQL injection not possible (Prisma parameterized) | All `*.repository.ts` | No raw SQL; all queries via Prisma client |
| C4 | Path traversal in resource IDs | Controllers | UUID validation on id parameters |
| C5 | Prototype pollution via JSON.parse | Anywhere using `JSON.parse` on user input | Uses safe parsing or Prisma handles it |

### D. Response Security

| # | Check | Files | Pass Criteria |
|---|-------|-------|---------------|
| D1 | `returned:never` attributes stripped from all responses | Projection logic | Password never in GET/LIST/PATCH/PUT responses |
| D2 | Credential hashes never in API responses | Credential endpoints | `credentialHash` stripped from list/create responses |
| D3 | Internal fields (`_schemaCaches`, `_*`) never leaked | Response serialization | Contract tests pass (9z-M) |
| D4 | Error responses don't leak stack traces in production | Exception filter | `NODE_ENV=production` omits stack |
| D5 | `X-Powered-By` header removed | `api/src/main.ts` | `app.getHttpAdapter().getInstance().disable('x-powered-by')` or Helmet |

### E. HTTP Security Headers

| # | Check | Files | Pass Criteria |
|---|-------|-------|---------------|
| E1 | CORS configured restrictively in production | `api/src/security/cors-origin.ts` | `CORS_ORIGIN` env var controls allowed origins |
| E2 | `Strict-Transport-Security` header present | Container App or app config | HSTS enabled for HTTPS |
| E3 | `X-Content-Type-Options: nosniff` | App or reverse proxy | Header present |
| E4 | `X-Frame-Options` or CSP `frame-ancestors` | App or reverse proxy | Clickjacking protection |

### F. Dependency Security

| # | Check | Files | Pass Criteria |
|---|-------|-------|---------------|
| F1 | No known HIGH/CRITICAL CVEs | `npm audit`, Trivy scan | Zero unmitigated HIGH+ CVEs |
| F2 | Dependabot enabled | `.github/dependabot.yml` | Configured for npm, actions, docker |
| F3 | CodeQL enabled | `.github/workflows/codeql.yml` | Weekly scan configured |
| F4 | Lock file integrity | `package-lock.json` | `npm ci` used in CI (not `npm install`) |

---

## Output Format

For each check, report:

```
| # | Status | Finding | File:Line | Severity |
```

Status: PASS / FAIL / WARN / SKIP
Severity: CRITICAL / HIGH / MEDIUM / LOW / INFO

Then provide:
1. **Executive Summary**: X/Y checks passed, Z findings
2. **Critical/High Findings**: Immediate action required (with fix code)
3. **Recommendations**: Improvements for defense-in-depth

---

## Self-Improvement

After each audit, append:
- New check items discovered during the audit
- False positives to skip in future runs
- Files/patterns that should be added to the checklist

<!-- Audit History -->
<!-- (populated after first run) -->
