---
name: entra-gallery-scim-e2e
description: Run the owned Microsoft Entra gallery provisioning application through SCIMServer dev with secret-token, OAuth client-credentials, and workload-identity authentication, bounded fixtures, exact cleanup, and structured evidence.
---

# Entra gallery provisioning to SCIMServer E2E

Use this skill when validating the real Microsoft Entra provisioning service against the current SCIMServer dev estate, especially after changes to authentication, discovery, User or Group mappings, membership, endpoint profiles, or deployment configuration.

## Safety boundary

1. Run only against the registry-resolved `dev` estate.
2. Use the dedicated `PRTest Entra Gallery Provisioning Test app` service principal only when it has zero pre-existing synchronization jobs.
3. Never modify the existing `SCIMValidation-*` production jobs. The WIF reference job is read-only and its secret values remain in memory.
4. Create source Users, Groups, app assignments, synchronization jobs, SCIM endpoints, and one federated identity credential with a unique run ID. The credential is added to the reviewed dev WIF resource application, never to a production application in another estate.
5. Remove every owned object by exact ID in `finally`, then verify no new job or endpoint remains.
6. Never print or persist bearer tokens, OAuth client secrets, WIF values, Graph tokens, or user passwords.
7. Treat a required mode reported as `BLOCKED`, `UNSUPPORTED`, or `SKIPPED` as a failed gate. Capability exclusions such as custom extension mappings remain explicit in the report.
8. Do not promote or change production as part of this skill.

## Run sequence

Start with the non-provisioning intake:

```powershell
pwsh -NoProfile -File scripts\entra-gallery-scim-e2e.ps1 -PlanOnly
```

Then run the complete required authentication matrix:

```powershell
pwsh -NoProfile -File scripts\entra-gallery-scim-e2e.ps1
```

The resource application ID is resolved from the reviewed WIF reference's
`connectivityParameters`. An optional `ENTRA_WIF_APPLICATION_ID` override must
match that reference. The gate derives an owned federated credential from the
reference's tenant-bound subject and creates a fresh endpoint and WIF trust.

WIF application identifiers use `PATCH synchronization/connectivityParameters`,
not `PUT synchronization/secrets`. The gate writes the complete WIF connectivity
configuration and verifies every saved field before provisioning. The corrected
focused gallery run passed 11 checks with zero failures. Do not treat a static
contract or the independent protocol proof as a replacement for this live flow.

Run the independent real-Entra WIF protocol proof through the temporary-app
wrapper:

```powershell
pwsh -NoProfile -File scripts\wif-e2e-temporary-app.ps1
```

The wrapper resolves the dev estate and tenant, creates a uniquely named Entra
application and service principal, keeps the one-time credential in process
memory, runs `wif-e2e-proof.ps1`, and deletes both directory objects by exact ID
in `finally`. The proof covers assertion acquisition, RFC 7523 token minting,
SCIM User and Group CRUD, negative cases, and exact cleanup. It does not replace
the gallery provisioning-service claim.

For focused diagnosis, select one or more modes:

```powershell
pwsh -NoProfile -File scripts\entra-gallery-scim-e2e.ps1 -Modes SecretToken
```

The executable gate owns all behavior. Do not reproduce its Graph or SCIM mutation logic in chat or in another skill.

## Evidence

Read the generated `test-results/entra-gallery-scim-e2e/<run-id>/result.json` and `summary.md`.

Report:

- exact PASS, FAIL, BLOCKED, UNSUPPORTED, and SKIPPED counts;
- outcome per authentication mode;
- User create, update, disable, and deprovision results;
- Group create, update, membership add/remove, and deprovision results;
- gallery schema and custom-extension disposition;
- cleanup verification;
- SCIMServer version and elapsed time.

Do not copy run-specific object IDs or any secret-bearing source response into committed documentation. Commit only a sanitized measured summary when release evidence is required.
