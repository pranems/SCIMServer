---
description: "Audit all logging and error handling paths across CRUD, config flags, bulk ops, auth, admin, deployment modes"
mode: "agent"
---

Go through all code paths and flows in the SCIMServer codebase to verify logging and error handling. Use the detailed checklist in #file:docs/PROMPT_LOGGING_VERIFICATION.md as the audit guide.

For each flow section (A through I), trace the actual code, verify logs are present at correct levels/categories, verify SCIM-compliant error responses with diagnostics extension, and report ✅/⚠️/❌ for each checkpoint.

After the audit:
1. List all failures sorted by severity
2. Provide specific code fixes
3. Add missing test cases
4. Update the prompt file itself per the self-improvement rules
