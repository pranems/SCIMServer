---
description: "Audit all error handling paths — exception filters, RepositoryError, diagnostics, SCIM compliance, auth errors, bulk isolation"
mode: "agent"
---

Go through all error handling code paths in the SCIMServer codebase to verify completeness and correctness. Use the detailed checklist in #file:docs/PROMPT_ERROR_HANDLING_VERIFICATION.md as the audit guide.

For each error path section (A through J), trace the actual throw site → catch site → filter → HTTP response. Verify SCIM-compliant responses, diagnostics extension, correct logging level, no internal detail leakage, and InMemory/Prisma parity.

After the audit:
1. List all failures sorted by severity
2. Provide specific code fixes with file:line references
3. Add missing test cases (unit/E2E/live)
4. Update the prompt file itself per the self-improvement rules
