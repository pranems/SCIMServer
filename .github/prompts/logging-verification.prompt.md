---
description: "Audit all logging and error handling paths across CRUD, config flags, bulk ops, auth, admin, deployment modes"
mode: "agent"
---

Go through all code paths and flows in the SCIMServer codebase to verify logging and error handling. Use the detailed checklist in #file:docs/PROMPT_LOGGING_VERIFICATION.md as the audit guide.

PII / privacy regulatory references (2026-05-17 update from first Stage X.2 intake):
- **GDPR Article 5(1)(b)+(c)** ([gdpr-info.eu/art-5-gdpr](https://gdpr-info.eu/art-5-gdpr/)) - purpose limitation + data minimization apply to log payloads.
- **EU AI Act (Regulation 2024/1689, Aug 2024)** ([eur-lex.europa.eu/eli/reg/2024/1689/oj](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)) - added "automated decision-making" as a special PII category. SCIMServer is NOT an automated decision system, but if Phase N+ adds any LLM-assisted log analysis the log payload may become a special-category input.
- **CCPA / CPRA** ([oag.ca.gov/privacy/ccpa](https://oag.ca.gov/privacy/ccpa)) + **PIPL** for non-EU jurisdictions.

PII redaction rules already enforced (per `docs/PROMPT_LOGGING_VERIFICATION.md`): plaintext credentials NEVER logged, bcrypt hashes NEVER logged, OAuth client secrets NEVER logged, request body redacted on credential routes. Audit confirms these on every code path that emits to `ScimLogger`.

For each flow section (A through N), trace the actual code, verify logs are present at correct levels/categories, verify SCIM-compliant error responses with diagnostics extension (including errorCode, conflictingResourceId, failedOperationIndex, parseError, currentETag, operation), and report checkmarks/warnings/failures for each checkpoint.

After the audit:
1. List all failures sorted by severity
2. Provide specific code fixes
3. Add missing test cases
4. Update the prompt file itself per the self-improvement rules
