# P1 - Keyed credential lookup (replacing the O(N) x bcrypt scan)

**Status:** **IMPLEMENTED for `bearer`** (phases 1-3) - v0.55.16, 2026-08-27
**Severity:** High (re-rated from Medium on measurement, 2026-08-27)
**Last verified:** 2026-08-27
**Owner:** auth workstream
**Register entry:** [REMAINING_WORK_REGISTER.md](REMAINING_WORK_REGISTER.md) - P1

> ## Outcome, measured
>
> A wrong token against **10 active credentials** on a live node answers in
> **7 ms**. Before P1 the same request cost ~2.9 s of bcrypt (10 x 287 ms).
>
> | | before | after |
> |---|---:|---:|
> | 3 active credentials | 860 ms | ~7 ms |
> | 10 active credentials | 2,866 ms | **7 ms (measured)** |
> | 25 active credentials | 7,165 ms | ~7 ms |
>
> **Scope of this increment:** **both credential types are now keyed.** `bearer`
> shipped in v0.55.16; `oauth_client` followed in **v0.55.17** using the **hybrid**
> format, which keeps the readable `client-secret-` prefix the operator asked for
> AND adds a lookup key:
>
> | Type | Format | Shipped |
> |---|---|---|
> | `bearer` | `scim_<24 hex>_<43 base64url>` | v0.55.16 |
> | `oauth_client` | `client-secret-<24 hex>-<43 base64url>` | **v0.55.17** |
>
> Legacy rows of **both** types still verify via bcrypt until rotated, and the
> scan now **skips** rows already migrated - so the remaining cost shrinks as
> rotation progresses rather than staying flat.

---

## 1. The problem, measured

When a caller presents an **opaque** per-endpoint token, the server cannot tell
which credential it belongs to, because the token carries nothing that
identifies itself. So it compares the presented token against **every active
credential on the endpoint**, one bcrypt at a time, in
[endpoint-credential.authenticator.ts](../../api/src/modules/auth/authenticators/endpoint-credential.authenticator.ts):

```ts
const credentials = await this.credentialRepo.findActiveByEndpoint(endpointId);
for (const cred of credentials) {
  const isMatch = cred.credentialHash ? await compare(token, cred.credentialHash) : false;
  if (isMatch) { /* accept */ }
}
```

Measured on this codebase (bcrypt cost factor 12, `npm run` on the dev machine,
2026-08-27):

| Active credentials | Worst-case auth cost |
|---:|---:|
| 1 | 287 ms |
| 3 | **860 ms** - already past the 800 ms `9z-BQ` latency gate |
| 5 (current default cap) | 1,433 ms |
| 10 | 2,866 ms |
| 25 (current max cap) | **7,165 ms** |

Three properties make this a denial-of-service surface rather than a latency
annoyance:

1. **The loop is reachable by an UNAUTHENTICATED caller.** Anyone who knows an
   endpoint id can send `Authorization: Bearer <any non-JWT string>` and force
   the full scan. Failing costs the server the *maximum*, because a mismatch only
   returns after every credential has been tried.
2. **The estate is small.** Container Apps replicas are 0.5 vCPU, single replica
   per revision. bcrypt is CPU-bound and blocks a worker thread.
3. **There is no HTTP rate limiting.** `@nestjs/throttler` is still on the
   deferred backlog, so nothing bounds request *frequency* either.

### 1.1 What is already mitigated

The X9 work added two short-circuits that skip the loop entirely, and they are
genuinely effective for legitimate traffic:

- **JWT-shaped tokens** skip it (a JWT can never match an opaque secret).
- **The global shared secret** skips it.

The P2 caps (v0.55.15) bound N to 5/5/10 by default, 25 maximum. That reduces the
worst case from unbounded to 7.2 s.

**None of this removes the amplification.** A caller who sends a random non-JWT
string still pays the full N x 287 ms, and N is attacker-visible only in the
sense that it is whatever the operator configured.

---

## 2. Why bcrypt is the wrong primitive *here*

This is the crux, and it is easy to get backwards.

bcrypt is deliberately slow to make **brute-forcing a human-chosen password**
expensive. OWASP's slow-hash guidance exists for that threat model.

A per-endpoint credential is **not a password**. It is minted by the server:

```ts
const plaintext = crypto.randomBytes(32).toString('base64url');
```

That is **256 bits of entropy**. Brute-forcing it is not merely impractical, it
is arithmetically impossible - there is no dictionary, no reuse, no human
pattern. A slow KDF therefore buys **nothing** against the only attack it was
designed to stop, while costing 287 ms on every verification.

This is the same conclusion GitHub, Stripe and AWS reached for API tokens: a
**high-entropy random secret** needs only a fast cryptographic hash plus a
constant-time comparison. The slowness is pure cost with no corresponding
benefit.

> **The one thing bcrypt still gives us** is that its output is salted, so two
> identical secrets produce different hashes. With a random 256-bit secret,
> collisions do not occur, so per-row salt is not load-bearing either. What *is*
> worth keeping is defence against a database-only compromise - addressed by a
> server-side **pepper** in section 3.3.

---

## 3. Proposed design

### 3.1 Token format

Give the token a **public, non-secret lookup key** so the server can find exactly
one candidate row:

```text
scim_<lookupKey>_<secret>
     |            |
     |            +-- 32 random bytes, base64url (the secret; never stored)
     +--------------- 12 random bytes, HEX (public identifier, stored + indexed)
```

The `scim_` prefix is deliberate: it makes the credential greppable in secret
scanners (GitHub secret scanning, trufflehog) and instantly recognisable in a
support ticket.

> **The lookup key is HEX, not base64url, and TDD is why.** The first
> implementation used base64url for both halves, and the round-trip test failed
> immediately: the base64url alphabet **includes `_`**, which is the separator,
> so a key containing `_` split in the wrong place and truncated. Hex cannot
> collide with the separator. The secret stays base64url because it is the last
> field - everything after the second `_`.

### 3.2 Verification path

```mermaid
flowchart TD
    A["Bearer token presented"] --> B{"JWT-shaped?"}
    B -->|yes| Z["OAuth / JWKS path"]
    B -->|no| C{"equals global shared secret?"}
    C -->|yes| Y["legacy global acceptor"]
    C -->|no| D{"matches scim_&lt;keyId&gt;_&lt;secret&gt;?"}
    D -->|yes| E["ONE indexed lookup by keyId"]
    E --> F{"row found and active?"}
    F -->|no| R["reject"]
    F -->|yes| G["HMAC-SHA256 secret with pepper"]
    G --> H{"timingSafeEqual vs stored"}
    H -->|yes| K["accept"]
    H -->|no| R
    D -->|"no - legacy token"| L["LEGACY: bounded bcrypt scan"]
    L --> M{"match?"}
    M -->|yes| K
    M -->|no| R
```

Cost of the new path: **one indexed SELECT + one HMAC**. Measured HMAC-SHA256
cost on the same machine: **0.00419 ms**, i.e. roughly **68,000x faster** than a
single bcrypt compare - and it no longer multiplies by N.

### 3.3 Storage

Add to the credential row:

| Column | Purpose |
|---|---|
| `lookupKey` | the public `keyId`, **UNIQUE indexed** - this is what makes it O(1) |
| `secretHash` | `HMAC-SHA256(pepper, secret)`, 32 bytes |
| `hashAlgo` | discriminator: `bcrypt` (legacy) or `hmac-sha256-v1` |

`credentialHash` stays for legacy rows. `hashAlgo` is what lets both formats
coexist without guessing.

**The pepper** is a server-side key (env `CREDENTIAL_HASH_PEPPER`), never stored
in the database. It restores the property bcrypt gave us for free: a dump of the
credentials table alone is not sufficient to verify tokens offline. Rotating it
requires re-issuing credentials, so it should be treated like `JWT_SECRET`.

> **Open question for review:** whether the pepper should live in Key Vault
> rather than an env var. Deferred deliberately - it is the same class of secret
> as `JWT_SECRET` and `OAUTH_CLIENT_SECRET`, and should be solved for all three
> together (see the deferred Managed Identity backlog item), not just this one.

### 3.4 Constant-time comparison

`crypto.timingSafeEqual` on the two 32-byte digests. Compare **digests, not
secrets**, so the lengths are always equal and `timingSafeEqual` cannot throw.

---

## 4. Migration

The hard constraint: **existing credentials must keep working.** They have no
`lookupKey` and their secret is unrecoverable (bcrypt is one-way), so they cannot
be silently upgraded.

```mermaid
flowchart LR
    P1["Phase 1<br/>schema + dual-path verify"] --> P2["Phase 2<br/>new credentials use HMAC"]
    P2 --> P3["Phase 3<br/>rotation upgrades in place"]
    P3 --> P4["Phase 4<br/>report legacy remaining"]
    P4 --> P5["Phase 5<br/>retire the bcrypt scan"]
```

| Phase | What happens | Reversible? |
|---|---|---|
| 1 **DONE** | Added `lookupKey` (unique), `secretHash`, `hashAlgo` (default `bcrypt`). Verification handles both. Strictly additive - every existing row stays valid. | yes |
| 2 **DONE** | New `bearer` credentials mint `scim_<lookupKey>_<secret>` + HMAC. Legacy rows untouched. | yes |
| 3 **DONE** | `POST .../rotate` issues the new format, so the existing rotation flow **is** the migration path - no new operator concept. | yes |
| 4 **DONE** | `GET /admin/credentials/migration-status` reports the remaining tail per endpoint, so it is **measured** rather than assumed. See [§4.4](#44-phase-4---the-measurement-surface). | yes |
| 5 TODO | Only once the measured legacy count is zero across all estates: delete the loop and the `bcrypt` dependency. | one-way |

**Phase 5 must be gated on measurement, not on elapsed time.** "It has been three
months, probably fine" is the reasoning that produced the EOL-Node escape.

### 4.2 Still on bcrypt after this increment

- **Pre-P1 rows of both types**, until rotated. `bearer` credentials issued before
  v0.55.16 and `oauth_client` secrets issued before v0.55.17 keep their bcrypt
  hash and keep working; rotation upgrades them in place.

### 4.3 The hybrid `oauth_client` format (v0.55.17)

The original P1 increment left `oauth_client` on bcrypt because its secret is
presented at the **token endpoint** rather than as a resource bearer, and because
the readable `client-secret-<uuid>` form was an explicit operator request. The
operator chose the **hybrid**, which gives up neither property:

```text
client-secret-700f9dedc3a004fc8f2f494e-k-E2PBpYxc7hftEKX-Ru_vKFWQfmFFE2AjBrKAr-E94
|------------| |----------------------| |-----------------------------------------|
      |                    |                              |
      |                    |                              +-- secret, 43 chars base64url
      |                    +-- lookupKey, 24 chars HEX
      +-- the readable prefix, preserved
```

**The hex key matters even more here than on the bearer format.** The separator
is `-`, and the base64url alphabet **contains** `-` - the real captured secret
above has four of them. A hex key cannot contain `-`, so the boundary is
unambiguous and the secret is simply everything after it.

Hex also gives the migration its safety property for free: **a legacy
`client-secret-<uuid>` can never false-match**, because a UUID's longest run of
hex is 12 characters (the final group) and the key needs 24. If it *could* match,
a legacy secret would be looked up by a bogus key, miss, and stop authenticating
- a silent customer outage. `P1-H7` asserts this over 500 real UUIDs rather than
arguing it.

**Where it is verified.** The token endpoint
([client-secret-token-provider.ts](../../api/src/modules/scim/controllers/client-secret-token-provider.ts))
still selects the candidate by `clientId` - that is the contract the caller
presents - and then verifies with one HMAC when the row is keyed, or bcrypt when
it is legacy. **Note that path was already O(1)**: it filtered by `clientId` and
did a single compare. The win is on the **resource plane**, where `oauth_client`
rows were part of the O(N) scan and are now skipped once migrated.

**Rotation preserves the public `clientId`** - only the secret changes - so an
integration re-reads one value, not two.

### 4.1 Bounding the legacy path meanwhile

Until phase 5, the legacy scan still exists. It should:

- run **only** when the token does not parse as `scim_<keyId>_<secret>`, and
- iterate only credentials with `hashAlgo = 'bcrypt'`.

Both narrow the window without changing behaviour for anyone.

### 4.4 Phase 4 - the measurement surface

`GET /scim/admin/credentials/migration-status` (admin-only) answers the one
question phase 5 depends on:

```json
{
  "generatedAt": "2026-09-03T02:41:07.912Z",
  "total": 75,
  "legacy": { "total": 0, "active": 0, "inactive": 0 },
  "keyed": { "total": 59, "active": 51, "inactive": 8 },
  "secretless": { "total": 16, "active": 16, "inactive": 0 },
  "byAlgo": {
    "bcrypt": 16,
    "hmac-sha256-v1": 59
  },
  "readyToRetireLegacyPath": true,
  "endpoints": []
}
```

`endpoints[]` lists **only** endpoints that still hold legacy rows, so the array
IS the work queue and an empty array means the work is done.

**Two counting decisions carry the whole safety property.**

**1. Inactive rows still count.** A deactivated credential can be brought back
by `POST .../credentials/:id/activate`. If phase 5 had already deleted the
bcrypt verifier, that credential would return and silently fail to
authenticate. So the gate is `legacy.total === 0`, not `legacy.active === 0`.
`P4-S2` and `P4-X4` pin this.

**2. A WIF trust is `secretless`, not legacy - and this was found by
measuring, not by reasoning.** The first run of this report against a live node
showed **32 legacy credentials on an estate where every credential had just
been minted in the keyed format**. They were all WIF trusts. A WIF row stores
no secret at all (`credentialHash: ''`) and sets no `hashAlgo`, so it inherits
the column default of `bcrypt` and *looks* legacy - but it is verified as a JWT
against a JWKS and never touches the bcrypt path. Counted naively it is a
legacy row that **can never be migrated**, so the gate would have been shut
permanently. The report classifies by credential type first, which fixes both
existing and future rows without a data migration. `P4-S9`, `P4-S10` and
`P4-X9` are the regression tests.

> This is the argument for phase 4 existing at all. A `TODO` that said
> "check the tail is empty before phase 5" would have been satisfied by a
> reading that was wrong in the safe direction *this* time - and there is no
> reason to assume the next miscount would be as harmless.

**Unrecognised algorithms fail closed.** Anything that is not provably
`hmac-sha256-v1` and not a secretless type counts as legacy, so introducing a
third algorithm cannot silently open the gate (`P4-S6`).

---

## 4A. End-to-end walkthrough with real data

Everything below was **captured live from the dev estate on 2026-09-02**, not
composed by hand. The secret shown belongs to a throwaway endpoint that was
deleted immediately afterwards.

### 4A.1 Step 1 - the operator mints a credential

```text
POST /scim/admin/endpoints/a02406b2-2c07-4b6a-a401-4b2a65f68a6e/credentials
Authorization: Bearer <admin OAuth JWT>
Content-Type: application/json
```

```json
{
  "credentialType": "bearer",
  "label": "trace-demo"
}
```

Response - **`201 Created`**. The `token` field appears exactly once, ever:

```json
{
  "id": "73755a2a-f105-4546-bfcd-8410953054e8",
  "endpointId": "a02406b2-2c07-4b6a-a401-4b2a65f68a6e",
  "credentialType": "bearer",
  "label": "trace-demo",
  "description": null,
  "active": true,
  "createdAt": "2026-09-02T20:39:38.755Z",
  "expiresAt": null,
  "token": "scim_fd5588f6a959fa323b2e5f8f_ba30aofsycHo4CRox_mv-O9_euGSF0jZhSP__QkgHzM"
}
```

### 4A.2 Anatomy of that token - and why the key is hex

```text
scim_fd5588f6a959fa323b2e5f8f_ba30aofsycHo4CRox_mv-O9_euGSF0jZhSP__QkgHzM
|--|  |----------------------|  |-----------------------------------------|
 |              |                                  |
 |              |                                  +-- secret: 43 chars base64url
 |              |                                      (32 random bytes = 256 bits)
 |              +-- lookupKey: 24 chars HEX (12 random bytes), PUBLIC, indexed
 +-- prefix: greppable by secret scanners
```

**Look at the real secret above: it contains `_` three times**
(`...Ho4CRox_mv-O9_euGSF0jZhSP__QkgHzM`). The base64url alphabet is
`A-Z a-z 0-9 - _`, so the separator character occurs *inside* the secret for
roughly half of all generated values.

This is not hypothetical. Splitting that captured token naively on `_` yields a
"secret" of **17 characters** instead of 43:

| Parse method | Recovered secret length | Correct? |
|---|---:|---|
| `split('_')[2]` | 17 | **no - truncated** |
| everything after the **second** `_` | **43** | yes |

Had the lookup key also been base64url, the key itself could contain `_` and the
boundary would be genuinely ambiguous - the token would fail to parse for a large
fraction of issued credentials. **Hex shares no character with the separator**,
which is why the key is hex while the secret stays base64url. The round-trip unit
test (`P1-T1`) caught this on its very first run, before any integration existed.

### 4A.3 What is persisted - the actual row

`EndpointCredential` after the create above:

| Column | Value | Note |
|---|---|---|
| `id` | `73755a2a-f105-4546-bfcd-8410953054e8` | |
| `endpointId` | `a02406b2-2c07-4b6a-a401-4b2a65f68a6e` | re-checked at auth time |
| `credentialType` | `bearer` | |
| `lookupKey` | `fd5588f6a959fa323b2e5f8f` | **UNIQUE index** - this is what makes it O(1) |
| `secretHash` | `<64 hex chars>` | `HMAC-SHA256(pepper, secret)` |
| `hashAlgo` | `hmac-sha256-v1` | selects the verifier |
| `credentialHash` | `p1-keyed-see-secretHash` | placeholder; the legacy column is NOT NULL |
| `active` | `true` | |

**The secret itself appears nowhere in that row** - only its HMAC. Because the
HMAC is peppered with a server-side key held outside the database, a dump of this
table alone is not sufficient to verify tokens offline. That is the one property
bcrypt gave us for free, and that a bare SHA-256 would have lost.

### 4A.4 Step 2 - an authenticated request, stage by stage

```text
GET /scim/endpoints/a02406b2-2c07-4b6a-a401-4b2a65f68a6e/Users?count=1
Authorization: Bearer scim_fd5588f6a959fa323b2e5f8f_ba30aofsycHo4CRox_mv-O9_euGSF0jZhSP__QkgHzM
```

```mermaid
sequenceDiagram
    participant C as Client
    participant G as SharedSecretGuard
    participant A as EndpointCredentialAuthenticator
    participant DB as EndpointCredential
    participant R as "SCIM handler"

    C->>G: "GET /Users with Bearer scim_fd55..."
    G->>A: "probe, order 10"
    A->>A: "endpointId present? yes"
    A->>A: "endpoint enables bearer? yes"
    A->>A: "looksLikeJwt? NO - so not the OAuth path"
    A->>A: "equals global shared secret? NO"
    A->>A: "parse prefix, split into key + secret"
    A->>DB: "findActiveByLookupKey fd5588f6a959fa323b2e5f8f"
    DB-->>A: "exactly ONE row - unique index"
    A->>A: "row endpointId matches route? yes"
    A->>A: "hashAlgo is hmac-sha256-v1? yes"
    A->>A: "HMAC with pepper, then timingSafeEqual"
    A-->>G: "accept, credentialId 73755a2a"
    G->>R: "authenticated"
    R-->>C: "200 OK"
```

Measured on dev: **588 ms** for that request cold, and **72 ms** for a rejected
wrong token. The rejection is the number that matters - it is the path an
unauthenticated attacker can drive, and pre-P1 it cost `N x 287 ms`.

### 4A.5 The four ways it can fail, and why each is distinct

All of these return `not-applicable` - the guard falls through to the next
authenticator - **except** the secret mismatch, which records a `fail` for the
decision trace.

| # | Condition | Check | Why it is separate |
|---|---|---|---|
| 1 | token is not `scim_<hex>_<...>` | `parseCredentialToken` returns `null` | Legacy tokens must fall through to the bcrypt scan. A **throw** here would turn every pre-P1 credential into a 500 - which is why the parser returns null and never throws (9 unit cases cover exactly this) |
| 2 | key unknown | `findActiveByLookupKey` returns `null` | No HMAC is computed at all; an unknown key costs one indexed miss |
| 3 | **key resolves to another endpoint** | `row.endpointId !== endpointId` | `lookupKey` is **globally** unique, so without this a stolen token would authenticate against *any* endpoint |
| 4 | secret mismatch | `timingSafeEqual` fails | Deliberately does **not** fall back to the scan - that would restore the amplification with a DB read on top |

Case 3 deserves a second look: the uniqueness that makes the lookup O(1) is
exactly what makes the endpoint re-check mandatory.

### 4A.6 Side by side, same request

```mermaid
flowchart TB
  subgraph BEFORE["BEFORE P1 - O(N) x bcrypt"]
    B1["wrong token"] --> B2["load ALL active credentials"]
    B2 --> B3["bcrypt compare 1 - 287 ms"]
    B3 --> B4["bcrypt compare 2 - 287 ms"]
    B4 --> B5["... every credential ..."]
    B5 --> B6["reject after N x 287 ms<br/>10 credentials = 2,866 ms"]
  end
  subgraph AFTER["AFTER P1 - keyed"]
    A1["wrong token"] --> A2{"parses as a keyed token?"}
    A2 -->|no| A3["scan, skipping migrated rows"]
    A2 -->|yes| A4["ONE indexed lookup"]
    A4 --> A5["reject - 32 ms measured on dev"]
  end
  style B6 fill:#ffe6e6
  style A5 fill:#e6ffe6
```

**A mismatch costs the maximum**, because every credential is tried before
rejecting. That is what made it an amplifier rather than a latency nuisance.

### 4A.7 A legacy credential, for contrast

A credential issued before v0.55.16 has `lookupKey = NULL`,
`hashAlgo = 'bcrypt'`, and a real bcrypt hash in `credentialHash`. Its token is a
bare 43-character base64url string with no `scim_` prefix, so the parse returns
`null` and it takes the legacy path - which now **skips** rows already migrated,
so the scan shrinks as rotation progresses.

Verified end to end during the upgrade rehearsal: a database at 18 migrations was
seeded with a legacy row, the **container** applied migration 19 at start, and the
row came out with `hashAlgo=bcrypt` / `lookupKey=<null>` and kept authenticating.

---

## 5. What this does NOT solve

Stated explicitly so the doc cannot be read as claiming more than it delivers:

- **It is not rate limiting.** One indexed lookup per request is cheap, but a
  flood is still a flood. `@nestjs/throttler` remains a separate backlog item and
  this design does not replace it.
- **It does not change the P2 caps.** They stay useful: they bound the legacy
  path during migration, and they bound row growth afterwards.
- **It does not address credential storage encryption** (`secretEnvelope` /
  `CredentialSecretVisibility`), which is an orthogonal feature.

---

## 6. Test plan (written before the code, per Stage 0)

All of the following are implemented and green.

| Level | Assertion | Where |
|---|---|---|
| Unit | a `scim_`-format token verifies via exactly **one** repository call - the call count is asserted, because "it works" would also pass if it fell through to the scan | `P1-A1` |
| Unit | a wrong secret with a **valid** key rejects, and does *not* fall back to scanning | `P1-A2` |
| Unit | an unknown key does no scan | `P1-A3` |
| Unit | a keyed row belonging to another endpoint is refused | `P1-A4` |
| Unit | a legacy token still verifies via bcrypt | `P1-A5` |
| Unit | the scan skips already-migrated rows, proven **behaviourally** (the row carries a real bcrypt hash that WOULD match) | `P1-A6` |
| Unit | negative control: the same row without the marker DOES match | `P1-A7` |
| Unit | token round-trip, entropy, pepper, malformed-hash safety (25 cases) | `credential-token.spec.ts` |
| E2E | a newly minted credential authenticates a real SCIM request | `P1-X1` |
| E2E | the row stores `lookupKey`/`secretHash` and **not** the secret | `P1-X2` |
| E2E | an existing legacy credential keeps working - **the migration's whole promise** | `P1-X5` |
| E2E | rotation upgrades a legacy row in place | `P1-X6` |
| **E2E perf** | 25 keyed credentials + a wrong token is faster than **3** legacy bcrypt rows, and under 250 ms | `P1-X7` |
| Unit (hybrid) | round-trip, entropy, separator-in-secret, and **500 real UUIDs never false-match** | `P1-H1..H9` |
| E2E (hybrid) | readable prefix kept + keyed shape; mints a token; forged secret refused; **a legacy `client-secret-<uuid>` still mints**; rotation upgrades in place | `P1-X8a..X8e` |
| Live | mint, authenticate, forge, cross-endpoint, rotate, re-authenticate | `9z-CL.T1-T7` |
| **Live perf** | a wrong token against 10 active credentials - **measured 7 ms** | `9z-CL.T8` |
| Live (hybrid) | prefix kept, keyed shape, mints, forged refused, rotation reissues hybrid and still mints | `9z-CL.T9-T14` |

The perf assertion carries a **negative control**: the same wrong token against
only three *legacy* rows must be measurably slower. Without it, a fast result
would not be attributable to the fast path.

---

## 7. Design/architecture gate

| Question | Answer |
|---|---|
| SRP | Verification strategy moves behind a seam; the authenticator stops knowing *how* a secret is hashed. Net reduction in its responsibilities. |
| Coupling | `hashAlgo` is a discriminator on the row, so the strategy is selected by data rather than by a branch the caller maintains. |
| Pattern consistency | Matches the existing `IAssertionTokenProvider` / repository-seam patterns already in this codebase. |
| Open/Closed | A third algorithm later (e.g. `hmac-sha256-v2` after a pepper rotation) is a new strategy, not an edit to the verifier. |
| Simplicity (YAGNI) | **Two** real implementations exist from day one (legacy bcrypt + HMAC), so the seam is justified rather than speculative. A general "hashing policy DSL" would not be, and is rejected. |
| Disposition | **(b) scheduled** - this document; implementation not yet started. |
