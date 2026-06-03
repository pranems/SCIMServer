# ISV SCIM Endpoint Probing - Comprehensive Methodology

> **Date:** 2026-05-13  
> **Audience:** SCIMServer maintainers + Microsoft Entra connector engineers + identity-integration teams onboarding any new ISV.  
> **Premise:** SCIM 2.0's discovery surface (RFC 7644 §4 + §5) tells you maybe 30 % of what an ISV's endpoint actually enforces. The other 70 % - format rules, allow-lists, ID conventions, ETag semantics, soft-delete idioms, filter precedence, error keyword vocabulary, rate limits, soft-failure modes - is invisible to `/Schemas`, `/ResourceTypes`, and `/ServiceProviderConfig`. This doc lays out a six-layer methodology for systematically and laterally extracting that hidden 70 %.  
> **Companion:** [OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md](OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md) - applies parts of this methodology to one specific ISV and surfaces the format-rules gap that broke the SyncFabric bot test.

---

## Table of Contents

- [0. Mental Model - the Six Layers](#0-mental-model---the-six-layers)
- [1. Layer 1 - RFC Discovery (the published surface)](#1-layer-1---rfc-discovery-the-published-surface)
- [2. Layer 2 - Behavioural Probing (active interrogation)](#2-layer-2---behavioural-probing-active-interrogation)
- [3. Layer 3 - Side-Channel Signals (passive observation of every byte)](#3-layer-3---side-channel-signals-passive-observation-of-every-byte)
- [4. Layer 4 - Out-of-Band Research (the OSINT / lateral angle)](#4-layer-4---out-of-band-research-the-osint--lateral-angle)
- [5. Layer 5 - Comparative / Triangulation](#5-layer-5---comparative--triangulation)
- [6. Layer 6 - Adversarial / Chaos Probing](#6-layer-6---adversarial--chaos-probing)
- [7. The Per-Attribute Probe Matrix](#7-the-per-attribute-probe-matrix)
- [8. The Probe Harness Vision](#8-the-probe-harness-vision)
- [9. Negative-Space Mapping](#9-negative-space-mapping)
- [10. Lifecycle Probing - the Whole-System Sweep](#10-lifecycle-probing---the-whole-system-sweep)
- [11. Lateral & Speculative Suggestions](#11-lateral--speculative-suggestions)
- [12. Applied - what these techniques would tell us about OpenText / AppRiver](#12-applied---what-these-techniques-would-tell-us-about-opentext--appriver)
- [13. Roadmap for SCIMServer to ship probing as a first-class capability](#13-roadmap-for-scimserver-to-ship-probing-as-a-first-class-capability)

---

## 0. Mental Model - the Six Layers

```
                              [ ISV SCIM ENDPOINT ]
                                       |
   +-----------------------------------+--------------------------------------+
   |                                                                          |
   v                                                                          v

L1: RFC DISCOVERY        L4: OUT-OF-BAND RESEARCH
"What the server says"   "What humans, code repos, and the internet say"
- /Schemas               - Vendor docs, KB, blog
- /ResourceTypes         - Microsoft Entra Gallery connector configs
- /ServiceProviderConfig - GitHub SDK / open source
- /Bulk meta             - Status pages, changelogs
- /Me                    - Job postings (stack reveals)
                         - Conference talks
                         - Stack Overflow

L2: BEHAVIOURAL PROBING  L5: COMPARATIVE / TRIANGULATION
"What the server does"   "What it does relative to peers"
- Round-trip diffing     - Run probe corpus against
- Boundary testing         multiple ISVs, diff
- Filter coverage matrix - Compare to RFC reference impl
- PATCH engine probe     - Compare to Entra inbound mock
- Lifecycle testing      - Compare wire shape: direct
                           call vs Entra connector vs
                           vendor SDK

L3: SIDE-CHANNEL         L6: ADVERSARIAL / CHAOS
"What it leaks"          "What it does under stress"
- HTTP headers (Server,  - Malformed JSON
   X-Powered-By, ETag    - Type confusion
   format)               - Oversize payload
- Location header host   - Unicode edge cases
- Status-code idioms     - Concurrent writes
- Date / TZ format       - Auth-token replay
- Latency profiles       - Rate-limit cliff
- TLS / DNS / WHOIS      - Cold-start vs warm

```

The six layers are **complementary, not alternatives**. A mature integration team uses all six. SCIM's discovery surface is necessary but radically insufficient on its own.

---

## 1. Layer 1 - RFC Discovery (the published surface)

### 1.1 The four-document sweep

Every SCIM 2.0 server SHALL expose four discovery documents. Hit all of them at onboarding time and **archive every byte**:

| Document | URL | What it tells you | What it doesn't |
|----------|-----|-------------------|-----------------|
| Service Provider Config | `/ServiceProviderConfig` | patch / bulk / filter / changePassword / sort / etag support; auth schemes; bulk maxOperations + maxPayloadSize; filter maxResults | **Whether the support is actually correct** (servers commonly advertise `bulk.supported:true` and then 501 on the first real bulk request) |
| Resource Types | `/ResourceTypes` | What endpoints exist (`/Users`, `/Groups`, custom types); which schemas + extensions bind to each | URL routing variants (`/scim/v2/Users` vs `/scim/Users` vs `/Users`); whether tenant is in path; case sensitivity of URL |
| Schemas | `/Schemas` | Per-attribute: type, multiValued, required, canonicalValues, caseExact, mutability, returned, uniqueness, subAttributes, referenceTypes | **Format rules**: regex / minLength / maxLength / pattern / pre-canonicalisation. **Cross-attribute rules**: postalCode-per-country, region-must-be-state-when-country=US. **Allow-lists**: hosted email domains, country codes. |
| Single-schema fetch | `/Schemas/{urn}` | Same as above but per-URN | Same |

### 1.2 Discovery probes you should always run

Beyond just downloading the four documents, run these probes against discovery itself:

- **Cache header check** - does `/Schemas` set `Cache-Control` or `ETag`? Tells you whether discovery is dynamic or pinned.
- **Anonymous access** - hit `/ServiceProviderConfig` with no auth. Some servers leak it, some don't. Reveals whether discovery is gated.
- **URN normalisation** - request `/Schemas/URN:IETF:PARAMS:SCIM:SCHEMAS:CORE:2.0:USER` (uppercase). 200 means the server is case-insensitive on URNs. 404 means it isn't.
- **Discovery vs runtime drift** - parse `/Schemas`, then for each declared attribute, send a POST that uses it. Anything declared but rejected is a discovery lie.
- **Reverse drift** - send a POST with an extra `weirdAttribute`. Strict mode means 400. Lenient mode silently accepts. The choice tells you a lot.
- **Pagination of /Schemas itself** - some servers paginate (e.g. ServiceNow). Set `count=1` and see if `totalResults > itemsPerPage`. If yes, you must follow `startIndex`.
- **Discovery freshness** - hit `/Schemas` once, change the deployment (if possible), hit again, diff. Reveals whether discovery is rebuilt or cached.

### 1.3 Discovery failure modes you must catalog

| Symptom | Likely cause | What it means |
|---------|--------------|---------------|
| 200 with empty `Resources[]` | Endpoint exists but returned an empty collection | Look for `totalResults` and pagination params - server may require explicit `count` |
| 401 | Discovery is auth-gated | Use the same bearer that works for `/Users` |
| 403 | Per-scope authorization | OAuth scope likely missing - check token claims |
| 404 | Wrong base path | Try `/scim/v2/`, `/scim/`, `/api/scim/v2/`, `/identity/scim/v2/` |
| 405 | GET not allowed (rare) | Server bug |
| 415 / 406 | Content negotiation | Try `Accept: application/scim+json` AND `application/json` |
| Returns single resource not list | Non-standard | Server doesn't conform to RFC 7644 §4 envelope - flag and log |
| Returns XML | Pre-SCIM-2.0 server (SCIM 1.1 used XML) | Refuse to integrate |

---

## 2. Layer 2 - Behavioural Probing (active interrogation)

This is where 70 % of useful ISV knowledge lives.

### 2.1 The round-trip diff (the single most valuable probe)

Take any payload you POST. GET the resource back. Diff the two. **Every difference is information.**

| Difference | What it reveals |
|------------|-----------------|
| Server stripped a field | Either readOnly stripping (RFC 7643 §2.2) or unknown-attribute filtering (strict mode) |
| Server added `id` / `meta.created` / `meta.lastModified` / `meta.location` / `meta.version` / `schemas[]` | Standard server-side defaults - confirm shape |
| Server normalised case (e.g. `userName` lowercased) | Identity normalisation policy - critical for filter testing |
| Server canonicalised a phone number `5551234` -> `+15551234` | Canonicaliser is active - learn the input shapes it accepts |
| Server stripped `primary:true` from one row | Primary enforcement is active - which mode? (normalize / reject / passthrough) |
| Server added `display` to a `members[]` entry | Server resolves member identity at write time - tells us referential integrity is enforced |
| Server reordered an array | Storage layer doesn't preserve order - filter `attr[index]` won't work |
| Server returned `boolean` where you sent `"true"` | Boolean-string coercion is active |
| Server omitted an attribute you sent that should be `returned:default` | Returned-characteristic enforcement bug |
| Server returned `{}` for an empty complex you sent as `null` | null vs absent vs empty handling - critical for PATCH semantics |

### 2.2 Boundary testing per attribute

For each attribute in `/Schemas`, run a small matrix:

| Probe | Send | Expected (compliant) | Variations to record |
|-------|------|---------------------|---------------------|
| Empty string | `"foo": ""` | 400 if required, 200 with blank if optional | Some servers convert "" -> null silently |
| Whitespace-only | `"foo": "   "` | Some servers trim, some store, some 400 | Critical for `userName` |
| Very long string | 10K chars | 400 / 413 / silent truncation | Reveals max-length |
| Null | `"foo": null` | RFC 7644 §3.5.2.3: removal signal in PATCH; in POST/PUT often = absent | Test in all three contexts |
| Number where string expected | `"foo": 123` | 400 with invalidValue | Reveals coercion policy |
| String where number expected | `"foo": "5"` | 400 OR coerced silently | Probes Postel's-Law tolerance |
| Boolean string `"True"` | for boolean attr | Some accept (Entra-style), some reject | Probes `AllowAndCoerceBooleanStrings` |
| Unicode NFD vs NFC | `"name": "café"` (composed) vs `"cafe\u0301"` (decomposed) | Should normalise to same | Server-specific |
| Emoji in name | `"displayName": "Alice 🎉"` | Usually accepted, sometimes 400 by downstream LDAP | |
| RTL marks | `"displayName": "Alice\u202E"` | Security concern - Unicode RTL override | |
| HTML / script chars | `"displayName": "<script>"` | Should NOT escape on store - SCIM is data, not HTML | Reveals XSS-prevention vs data-mangling policy |
| Leading whitespace | `"userName": " alice"` | Most servers trim; some don't | Critical for uniqueness |
| Trailing dot | `"emails[].value": "alice@example.com."` | Valid DNS, often rejected | |

### 2.3 Filter coverage matrix

Build the matrix below by running `GET /Users?filter=...` and recording outcome.

| Operator | Probe | Expected | Notes |
|----------|-------|----------|-------|
| `eq` | `userName eq "alice"` | 1 result | Baseline |
| `eq` (mixed case) | `USERNAME EQ "alice"` | Should match | Tests case-insensitivity of operator + attribute |
| `eq` (caseExact) | `externalId eq "AbC"` then `eq "abc"` | Schema-driven; if `caseExact:true` only first matches | |
| `ne` | `active ne true` | Compliant | Some servers don't support |
| `co` | `displayName co "lice"` | Substring | Often slow / unindexed |
| `sw` | `displayName sw "Al"` | Prefix | Usually fast (B-tree index) |
| `ew` | `displayName ew "ice"` | Suffix | Often slow OR unsupported |
| `pr` | `title pr` | All with title | Tests presence semantics |
| `gt` `lt` `ge` `le` | on dateTime / integer | Should work | Common bug: server treats as string compare |
| `not` | `not (active eq true)` | Negation | Some servers reject parens |
| `and` / `or` | `a eq 1 and b eq 2` | Combined | |
| Precedence | `a eq 1 and b eq 2 or c eq 3` | RFC 7644 §3.4.2.2: `and` binds tighter | Many servers get this wrong |
| Grouped | `(a eq 1 or b eq 2) and c eq 3` | Should respect parens | |
| Complex attr | `name.givenName eq "Alice"` | Sub-attribute filter | |
| Bracket filter | `emails[type eq "work"].value eq "alice@x.com"` | Filtered traversal | THE most-divergent area |
| Multi-value `pr` | `emails pr` | "Has at least one email" | Often unsupported |
| URL encoding | `userName eq %22alice%22` | Should match | Some servers double-decode |
| Embedded `+` | `userName eq "a+b@x.com"` (URL `+` = space!) | Test both `+` and `%2B` | Common bug |

### 2.4 The PATCH engine - the single most divergent area

PATCH (RFC 7644 §3.5.2) is where vendors disagree most. Probe **every combination**:

| Probe | Body | What it reveals |
|-------|------|-----------------|
| Path-less `replace` | `{op:"replace", value:{active:false}}` | Top-level merge support |
| Simple path | `{op:"replace", path:"active", value:false}` | Basic path |
| Sub-attribute path | `{op:"replace", path:"name.givenName", value:"Bob"}` | Dotted paths |
| Multi-valued add | `{op:"add", path:"emails", value:[{value:"x@y.com",type:"home"}]}` | Append vs replace? |
| Filtered remove | `{op:"remove", path:"emails[type eq \"home\"]"}` | Bracket filter in path |
| Filtered replace | `{op:"replace", path:"emails[type eq \"work\"].value", value:"new@x.com"}` | Filtered sub-attr |
| Extension URN path | `{op:"replace", path:"urn:...:enterprise:2.0:User:department", value:"Sales"}` | Extension addressing |
| Extension sub-attr path | `{op:"replace", path:"urn:...:enterprise:2.0:User:manager.value", value:"abc"}` | Deepest path form |
| Remove without value | `{op:"remove", path:"title"}` | Should succeed (RFC says no value) |
| Remove with value | `{op:"remove", path:"title", value:"x"}` | Some servers reject; RFC ambiguous |
| Add to single-valued | `{op:"add", path:"displayName", value:"X"}` | Add semantics on single-valued = replace? error? |
| Members add | `{op:"add", path:"members", value:[{value:"id1"}]}` | Group membership |
| Members remove all | `{op:"remove", path:"members"}` | Wipe? Or 400? |
| Members remove one | `{op:"remove", path:"members[value eq \"id1\"]"}` | Selective removal |
| Multiple ops | `Operations:[op1, op2, op3]` | All-or-nothing? Partial? |
| Op order matters | add A then remove A vs remove A then add A | Tests transactional vs sequential semantics |
| Empty Operations | `{schemas:[...PatchOp], Operations:[]}` | 200 no-op? 400? |
| Invalid op | `{op:"upsert", ...}` | 400 with `invalidSyntax`? |
| Mixed casing | `{op:"REPLACE", ...}` vs `{op:"replace"}` | RFC 7644 §3.5.2 says case-insensitive |
| readOnly attribute | `{op:"replace", path:"id", value:"x"}` | Should 400 or silently strip |

### 2.5 Conditional / concurrency probing

| Probe | Setup | Expected |
|-------|-------|----------|
| If-Match correct | GET, take ETag, PUT with `If-Match: <etag>` | 200 |
| If-Match wrong | PUT with stale ETag | 412 Precondition Failed |
| If-Match missing when RequireIfMatch=true | PUT without header | 428 Precondition Required |
| If-None-Match: * on POST | Conditional create | Compliant servers 412 if exists; common bug: ignored |
| Conditional GET | `If-None-Match: <etag>` | 304 Not Modified |
| ETag format inspection | `W/"v3"` vs `"abc123"` vs `W/"<ISO>"` | Reveals state model (counter / hash / timestamp) |
| Strong vs weak ETag | Look for `W/` prefix | Most SCIM impls use weak |
| Concurrent PUT | Two PUTs simultaneously with same If-Match | One should 412; some servers happily double-write |
| ETag stability across read | GET twice, compare | Stable = good; changes = ETag is non-deterministic |

### 2.6 Pagination probing

| Probe | What you learn |
|-------|----------------|
| `count=1, startIndex=1` | Server uses 1-based indexing (RFC compliant) or 0-based (Microsoft Graph) |
| `count=0` | Should return `Resources:[]` with `totalResults=N`; some return all |
| `count=10000` | Server clamps to its own max; reveals `filter.maxResults` even when not advertised |
| `startIndex=large` | Out-of-range - empty `Resources` or 400? |
| Page through all | Walk pages, dedupe, compare to `totalResults` | Reveals consistency under writes |
| Same page twice | Stable order? Or order randomises? | Sort stability |
| Filter + pagination interaction | Filter narrows; pagination should still work | Common bug: filter ignored on page 2 |
| Sort + pagination | `sortBy=userName&sortOrder=ascending` | Many servers don't actually sort across pages |

---

## 3. Layer 3 - Side-Channel Signals (passive observation of every byte)

Every byte the server emits is a signal. Most teams throw 95 % of these bytes away.

### 3.1 HTTP header forensics

| Header | What it reveals | Real example from OpenText evidence |
|--------|-----------------|--------------------------------------|
| `Server` | Web server (nginx, IIS, Kestrel, Tomcat) | (absent in OpenText - LB stripping) |
| `X-Powered-By` | App framework | `ASP.NET` -> .NET Framework or .NET Core; older = Framework |
| `Date` | Server clock | RFC 1123 format - check for clock drift |
| `Transfer-Encoding: chunked` | Streaming response | OpenText uses chunked - means response generator streams (good for scale) |
| `Content-Type` | Negotiation outcome | `application/scim+json` (compliant) vs `application/json` (non-compliant per RFC 7644 §8.1) |
| `Location` | Resource URL after POST | OpenText evidence: `https://scim.apps.appriver.corp/api/Groups/...` - **leaks the internal hostname** different from public `api.appriver.com` |
| `ETag` | Concurrency token format | Reveals state model |
| `X-RateLimit-Limit` / `Remaining` / `Reset` | Rate limiting present | If present, learn the budget; if absent, no public budget |
| `Retry-After` | On 429 / 503 | Server's preferred backoff |
| `X-Request-Id` / `X-Correlation-Id` | Trace token format | OpenText puts it in the body (`detail: "...correlation:c3db4240-..."`) - most servers use header |
| `Strict-Transport-Security` | HTTPS hardening | Security posture signal |
| `X-Frame-Options` / `CSP` | Security headers | Tells you the security maturity |
| `Vary` | Cache key | Reveals what dimensions affect response |
| `Cache-Control` | Cacheability | `no-cache` on PII (good); `public,max-age=60` on errors (bad) |
| `WWW-Authenticate` on 401 | Auth scheme details | `Bearer realm="..."` reveals OAuth token endpoint sometimes |

### 3.2 The Location-header trick (revealing internal architecture)

In `Bot Eval Group add test.txt`:
```
Resource: https://api.appriver.com/scim/api/Groups
...
Response Headers: Location: https://scim.apps.appriver.corp/api/Groups/7f06689d-...
```

**Public hostname `api.appriver.com` !=  internal hostname `scim.apps.appriver.corp`.**

This single header tells us:
- AppRiver runs an Azure Front Door / API Management / nginx ingress (`api.appriver.com`) in front of an internal service (`scim.apps.appriver.corp`).
- The internal service is **publicly addressable** if you can reach the corp DNS - potential security finding in some environments.
- The path translates: public `/scim/api/Groups` -> internal `/api/Groups`. The `/scim` prefix is ingress-only.
- The internal hostname uses `.corp` TLD - typical Microsoft / corporate AD-joined naming.
- They use a single ingress for all of api.appriver.com and route via path - they probably don't have per-tenant subdomains.

Capture the Location header on every POST and grep for hostname inconsistency. This is a free architectural map.

### 3.3 Status-code idioms

| Idiom | What it reveals |
|-------|-----------------|
| 201 with body | Compliant (RFC 7644 §3.3) |
| 200 with body | Common deviation (Salesforce did this for a while) |
| 204 with no body on POST | Non-compliant - means client must follow Location |
| 202 Accepted on POST | Async provisioning - work happens later |
| 429 with `Retry-After` | Rate-limited; takes the budget seriously |
| 429 without Retry-After | Take a guess (start at 1s, exponential) |
| 503 on cold start | Serverless backend (Lambda / Functions / Cloud Run) |
| 502 on slow request | Reverse-proxy timeout (nginx default 60s) |
| 504 on slow request | Different proxy / different timeout |
| 400 with `scimType:invalidValue` and no `attributePaths` | Generic validator - probably custom .NET (this is OpenText's pattern) |
| 400 with `scimType:invalidValue` and `attributePaths:["foo.bar"]` | Modern validator (SCIMServer's pattern after v0.39.0) |
| 400 with `scimType:invalidSyntax` | JSON parse / SCIM grammar error |
| 409 with `scimType:uniqueness` | Standard duplicate detection |
| 412 vs 428 on missing If-Match | RFC ambiguity - 428 is preferred per RFC 6585 |

### 3.4 Body shape forensics

Even small body details reveal architecture:

```
Date format:   "2026-05-13T23:59:48.7146579Z"  -> .NET DateTime with 100-ns ticks (7-digit fractional)
              "2026-05-13T23:59:48.714Z"        -> Java Instant.toString() (3-digit)
              "2026-05-13T23:59:48Z"            -> Truncated; library default
              "2026-05-13T23:59:48.7146579+00:00" -> Explicit offset; could be Java OffsetDateTime
              
ID format:    UUIDv4 lowercase with hyphens                         -> Postgres / Node / Java
              UUIDv4 uppercase with hyphens                          -> .NET Guid.ToString("D")
              UUIDv4 with braces                                     -> .NET Guid.ToString("B") (rare)
              cuid_ prefix                                            -> Node ecosystem
              ULID (26 chars Crockford-base32)                       -> Modern Node / Go
              Sequential int                                          -> Legacy SQL
              Auth0-style "auth0|abc123"                              -> Federated identity service
              
Correlation:  c3db4240-7611-4dc2-b97b-45b2908c3127  -> UUIDv4 -> standard
              78452BA6971E82E412438B04B7859F62        -> 32-hex SHA fragment -> custom
              W3C traceparent format                  -> OpenTelemetry instrumented
```

OpenText evidence shows `2026-05-13T23:59:48.7146579Z` - .NET DateTime, 7-digit fractional confirms .NET stack already inferred from `X-Powered-By: ASP.NET`.

### 3.5 Latency profiling

Run a 100-request burst against each major route and bucket the latency:

| Pattern | Likely cause |
|---------|--------------|
| Bimodal (fast + slow buckets) | Cache hit vs miss |
| 1 request takes 5s, rest take 50ms | Cold start on serverless |
| Latency rises over the burst | DB connection pool exhaustion |
| Latency stable | Well-tuned, has connection pooling |
| Sudden 503s after N requests | Hit a rate limit or pool limit |
| `co` filter takes 100x longer than `eq` | No full-text index; `co` does table scan |
| `members[value eq "x"]` slow on large groups | No JSONB GIN index on members.value |

These latency fingerprints diagnose the backend without ever asking a human.

---

## 4. Layer 4 - Out-of-Band Research (the OSINT / lateral angle)

Everything the engineering team has published outside the API.

### 4.1 The Microsoft Entra Gallery connector configs (gold mine)

Public connector packages contain `synchronizationRules` - already-translated maps from Entra source to ISV target. The OpenText evidence has this:

- `defaultSourceObjectMappings` reveals `OriginalJoiningProperty: "userPrincipalName"` -> Microsoft engineers picked UPN as the join key, which means OpenText keys on `userName`.
- `targetAttributeName` tells you exactly which target attribute Microsoft thinks each Entra source attribute maps to.
- `IsCustomerDefined: false` means **Microsoft baked this in based on direct knowledge of the target** - either docs, vendor calls, or empirical testing.
- `flowType: Always` vs `FlowWhenChanged` reveals which fields Microsoft thinks are mutable.
- `defaultValue: "True"` on `accountEnabled` reveals the target requires it (or Microsoft is being conservative).
- `IsSoftDeletionSupported: "true"` / `"false"` per object: Microsoft's verdict on soft-delete capability.
- `IsSynchronizeAllSupported: "true"` per User but `"false"` for Group on OpenText: tells you the directory full-sync model.

**Action:** for any new ISV, fetch the public connector package from Microsoft Entra Gallery (or Graph API `/applicationTemplates`) and treat it as a free 80 % spec.

### 4.2 Vendor docs - what to extract

| Doc | What to mine |
|-----|--------------|
| API reference | Authentication flow, token endpoint, scope names, base URL pattern |
| Onboarding guide | Required tenant setup steps, allow-listed domains, service principal grants |
| FAQ / Knowledge Base | Known issues, common errors (these usually map directly to vendor-specific 400 reasons) |
| Status page | Subsystems exposed (`SCIM API`, `Auth Service`, `Provisioning Engine`) - reveals architecture |
| Changelog | Versioning policy, breaking-change cadence |
| SDK on GitHub | Reference implementation - read the validation code |
| Postman collection | Reveals test data shape (real ISV test data) |
| OpenAPI / Swagger spec | Often hidden but public - try `/swagger`, `/api-docs`, `/openapi.json` |
| Terraform provider | Reveals what's API-managed vs UI-only |

### 4.3 Vendor stack signals (the indirect indicators)

| Signal | What it reveals |
|--------|-----------------|
| Job postings ("experience with .NET 8 SCIM") | Stack & seniority |
| LinkedIn employee skills | Same |
| Open source contributions | Libraries used |
| Engineering blog | Architecture, scaling decisions, postmortems |
| Conference talks (Identiverse, KuppingerCole, Gartner IAM) | Roadmap & philosophy |
| Twitter / Mastodon eng accounts | Real-time issue acknowledgement |
| GitHub orgs | SDKs, sample apps, issue tracker (read CLOSED issues for "we don't support X") |

### 4.4 OAuth / OIDC introspection

The bearer token is itself a discovery document:

```
Decode OpenText bot test token:
  iss: "https://account.appriver.com/identity"
  aud: (implicit)
  scope: ["openid", "profile", "BosunClaims"]
  amr: ["pwd"]
  client_id: "ee122508-44a8-4e6e-a42a-348c7e95064b"
  sub: "smadmin@appriver.io"
  cid: "b3270995-d287-4f22-8f03-ab9d0163deaf"
  CustomerID: "561632"
  PartnerID: "0"
  AuthViaCustomerIdentity: "true"
  role: ["CUSTOMER_ADMIN", "CUSTOMER_SUPERADMIN", "CUSTOMER_USER"]
```

**Inferences:**
- `BosunClaims` - internal codename for AppRiver's permission model. Don't ignore unusual scopes - they often reveal product internals.
- `CustomerID: "561632"` - 6-digit numeric customer ID (legacy ERP-style, not UUID-style). Suggests AppRiver predates the UUID era.
- `PartnerID: "0"` - tenant-of-tenants model (resellers). Confirms multi-tenant architecture.
- Role hierarchy `CUSTOMER_USER` < `CUSTOMER_ADMIN` < `CUSTOMER_SUPERADMIN` - 3-tier RBAC.
- `iss: "https://account.appriver.com/identity"` - separate auth service from data service (`api.appriver.com`).

OAuth introspection (RFC 7662) endpoint - if the ISV exposes one at `/connect/introspect` or `/oauth/introspect`, you can validate / inspect any token.

### 4.5 DNS / TLS / network OSINT

| Tool | What it tells you |
|------|-------------------|
| `dig api.appriver.com` | A/AAAA records, CNAME chain (often reveals CDN: cloudfront / fastly / azurefd) |
| `whois <ip>` | Hosting provider (Azure / AWS / GCP / on-prem) |
| `openssl s_client -connect <host>:443 -showcerts` | Cert SANs reveal sister hostnames |
| TLS JA3 fingerprint | Reveals the TLS stack version |
| ALPN advertised protocols | h1 vs h2 vs h3 |
| `traceroute` | Network distance |
| `crt.sh` | Certificate transparency log - reveals every subdomain ever issued a cert (including dev/staging) |
| Shodan / Censys | Open ports, deployed services, software versions |

For OpenText/AppRiver, the Location header already leaked `scim.apps.appriver.corp`. CT logs would likely surface every other `*.appriver.corp` hostname they've ever provisioned.

---

## 5. Layer 5 - Comparative / Triangulation

The single best way to know whether server behaviour is RFC-compliant or vendor-specific: **diff against peers running the same probe corpus**.

### 5.1 The triangulation matrix

| Implementation | Run probe X | Result |
|----------------|-------------|--------|
| RFC reference impl (e.g. Microsoft.SCIMReferenceApi on GitHub) | X | A |
| Microsoft Graph SCIM (Entra inbound) | X | B |
| Okta SCIM | X | C |
| ServiceNow SCIM | X | D |
| The ISV under test | X | E |
| **SCIMServer** | X | F |

If A=B=C=D=F but E differs -> ISV is non-standard. Document.  
If A=E and others differ -> ISV is the most compliant; others are quirky.  
If everyone differs -> RFC ambiguity; pick the safest behaviour.

This matrix is exactly how SCIMServer's compliance test corpus was built.

### 5.2 Channel-diff testing

Send the same logical operation through 3 channels and diff the wire bytes:

1. **Direct curl** - your control payload
2. **Microsoft Entra connector** - what the production flow actually sends
3. **Vendor SDK** (if shipped)

You'll learn:
- What headers Entra adds (`ADSCIMVersion: Date:..., ActivityId:...`)
- What attributes Entra reshapes (e.g. `accountEnabled` -> `active`, `mail` -> `emails[type=work]`)
- Order of operations Entra picks (POST then PATCH? PUT?)
- How Entra handles soft-delete (PATCH active=false vs DELETE)
- How Entra handles updates (PUT vs PATCH preference)

OpenText evidence shows `ADSCIMVersion` header carries a **schema version** the connector reads from the target. Useful as a freshness check.

### 5.3 Cross-resource-type triangulation

Test the same probe on User and on Group and on a custom resource type. Behaviour that differs between resource types reveals which validators are wired up where. Concrete OpenText case:
- Group POST with random `displayName` -> 201 Created
- User POST with same level of randomness -> 400 invalidValue

The diff isolates the failure to **fields that exist on User but not on Group**: emails, phoneNumbers, addresses, country, postalCode, region, externalId-with-domain, mailNickname-style userName.

---

## 6. Layer 6 - Adversarial / Chaos Probing

What does the server do when you misbehave?

### 6.1 Malformed transport

| Probe | Expected |
|-------|----------|
| `Content-Type: text/plain` | 415 Unsupported Media Type |
| Body is not JSON | 400 invalidSyntax |
| Body is JSON but missing `schemas[]` | 400 invalidSyntax |
| `schemas: ["nonsense"]` | 400 invalidSyntax |
| Empty body on POST | 400 |
| 100MB body | 413 Payload Too Large or proxy timeout |
| Trailing garbage after JSON | 400 |
| BOM (`\uFEFF`) at start | Some servers 400, some accept |
| Multiple JSON objects concatenated | 400 |
| Streaming chunk with wrong length | 400 |
| HTTP/1.0 (no Host) | 400 |
| HTTP/0.9 | 400 / closed connection |

### 6.2 Concurrent / race-condition probing

| Probe | What it tests |
|-------|---------------|
| 2 POSTs with same `userName` simultaneously | Uniqueness race - one should 409 |
| 2 PUTs to same resource same If-Match | One should 412 |
| POST followed instantly by GET | Read-your-write consistency |
| DELETE followed by GET | Should 404 (or 410 if RFC 7232) |
| POST + DELETE same resource racing | Tombstone behaviour |
| 1000 concurrent GETs | Connection pool stress |

### 6.3 Auth chaos

| Probe | Expected |
|-------|----------|
| Token replay after expiry | 401 |
| Token from different tenant | 401 / 403 |
| Token with wrong audience | 401 |
| Token with wrong scope | 403 |
| Mangled signature | 401 |
| `Bearer <empty>` | 401 |
| `Bearer ` with trailing space | 401 (some accept!) |
| Two `Authorization` headers | 400 / undefined |
| Auth via `?access_token=` query | RFC 6750 deprecates; servers vary |
| Lower-case `bearer` | RFC says case-insensitive |

### 6.4 Resource-exhaustion probing (do this in a non-prod env)

| Probe | What it reveals |
|-------|-----------------|
| Add 10K members to a group | Performance characteristic; pagination of `members` |
| Create 1M users | DB scale ceiling |
| 100 PATCH ops in one request | `bulk.maxOperations` lie detection |
| Filter `displayName co "a"` returning 99 % of users | Index design |
| Concurrent rapid create/delete | Tombstone leak / soft-delete buildup |

---

## 7. The Per-Attribute Probe Matrix

For every attribute in `/Schemas`, fill out this template. It's the systematic version of the per-attribute walk in OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md §3.

```yaml
attribute: emails
schema: urn:ietf:params:scim:schemas:core:2.0:User
characteristics_declared:
  type: complex
  multiValued: true
  required: false
  mutability: readWrite
  returned: default
characteristics_observed:
  required:    [server-rejected when omitted? (no/yes)]
  mutability:  [PUT changing succeeds? (yes/no)]
  returned:    [appears in default GET? in ?attributes=? in ?excludedAttributes=?]
  uniqueness:  [POST same emails value -> 409? (yes/no)]
sub_attribute: value
  type_observed: string
  format_check: [send "not-an-email" -> response code]
  length_check: [send 1-char / 320-char / 1000-char]
  empty_check: [send "" -> 400 / 200 / silently dropped]
  null_check: [send null -> 400 / 200 / drops the entry]
  case_norm: [POST "Alice@X.COM", GET back -> what case?]
  unicode_norm: [POST "café" composed vs decomposed -> diff?]
  whitespace: [send " alice@x.com ", GET back -> trimmed?]
sub_attribute: type
  canonicalValues_enforced: [send "weird" -> 400? silent? other?]
  case_norm: [send "WORK", GET back -> case?]
sub_attribute: primary
  cross_row_constraint: [post 2 entries with primary:true -> 400 / one-flipped / both-stored]
filter_support:
  emails eq "x@y.com": [200/400]
  emails[type eq "work"].value eq "x@y.com": [200/400/500]
  emails pr: [200/400]
patch_support:
  add path=emails value=[{...}]: [200/400]
  remove path=emails[type eq "work"]: [200/400]
  replace path=emails: [wipe-then-add? merge? error?]
returned_in:
  POST 201 body: [yes/no]
  PUT 200 body: [yes/no]
  PATCH 200 body: [yes/no]
  GET 200 body: [yes/no]
  ?attributes=emails: [yes/no]
  ?excludedAttributes=emails: [omitted? still present?]
  ListResponse: [yes/no]
```

Run this for all ~30 attributes of User, ~5 of Group, plus custom extensions. The result is a **behavioural contract** for the ISV that you can diff against future versions.

---

## 8. The Probe Harness Vision

Rather than running ad-hoc Postman calls, build a probe harness once and reuse it for every ISV.

### 8.1 Architecture

```
   probe-corpus.yaml                   ISV under test
   (declarative spec of                       ^
    every probe + expected)                   |
           |                            HTTP requests
           v                                  |
   probe-runner (PowerShell                   |
    or Node CLI)  ----------------------------+
           |
           v
   probe-results.jsonl  --> diff against last week --> alert on regression
                       --> diff against ISV B   --> ISV-specific quirk catalog
```

### 8.2 Probe definition (YAML example)

```yaml
- id: filter-eq-username
  category: layer2.filter
  request:
    method: GET
    path: /Users
    query:
      filter: 'userName eq "{{seedUserName}}"'
  expect:
    status: 200
    body.totalResults: 1
    body.Resources[0].userName: '{{seedUserName}}'
  classify:
    pass: standard
    fail-status: server-non-compliant
    fail-content: filter-engine-bug

- id: patch-extension-urn-path
  category: layer2.patch
  setup:
    create: user
    record_as: subject
  request:
    method: PATCH
    path: /Users/{{subject.id}}
    body:
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp']
      Operations:
        - op: replace
          path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department'
          value: 'NewDept'
  expect:
    status: 200
  followup:
    request:
      method: GET
      path: /Users/{{subject.id}}
    expect:
      body[urn:...:enterprise:2.0:User].department: 'NewDept'

- id: round-trip-canonicalisation
  category: layer2.round-trip
  request:
    method: POST
    path: /Users
    body: { ... full user ... }
  diff:
    capture: created
  followup:
    request:
      method: GET
      path: /Users/{{created.id}}
    diff:
      against: created
      report: differences
```

### 8.3 Probe-result classification

Every probe outcome falls into one of:
- `pass` - matches RFC + matches our expected
- `pass-deviated` - server returned something different but still valid
- `fail-rfc-violation` - server broke RFC
- `fail-vendor-specific` - server enforced a rule the schema didn't advertise
- `fail-undocumented-error` - 5xx or unexpected 4xx
- `skip-precondition-missed` - couldn't run (e.g. depends on a prior failed probe)

Aggregating these across 200+ probes gives a single-number compliance score per ISV plus a per-area heatmap.

### 8.4 Probe corpus seeding

Seed the corpus from:
1. RFC 7643 + RFC 7644 (every MUST and SHOULD)
2. Known-good ISVs (Okta / Workday / Salesforce conformance test data)
3. Microsoft Entra synthetic-test payloads
4. Existing SCIMServer test suite (3,720 unit + 1,184 E2E + 955 live)
5. Known-failure cases captured in production logs (regression locks)

---

## 9. Negative-Space Mapping

What's NOT in the schema is often more informative than what is.

### 9.1 Inference table

| Absence | Inference |
|---------|-----------|
| No `password` attribute | Auth is federated (SAML/OIDC); SCIM ships profile only |
| No `groups` attribute on User | Membership is one-directional (Group -> User) |
| No `manager` in EnterpriseUser | No org-chart - flat directory model |
| No `bulk.maxOperations` advertised | Bulk is likely unsupported even if `supported:true` |
| `schemas: []` empty on a ResourceType | Untested code path |
| No `authenticationSchemes` | Server doesn't actually negotiate - hardcoded to one scheme |
| No `meta.version` on returned resources | No optimistic concurrency - races silently corrupt |
| No `meta.location` | Client must construct URLs - error-prone |
| `caseExact` everywhere (or nowhere) | Schema author copy-pasted; characteristics may not be true |
| All `mutability:readWrite` | Mutability isn't actually enforced on writes |
| `uniqueness:none` everywhere except `userName` | Schema author respects RFC defaults; trustworthy |
| `referenceTypes` advertised but no `$ref` validation in practice (probe-confirmed) | G-1-style gap (see OpenText doc) |
| No `/Bulk` route 405 | Bulk hard-disabled at routing layer |
| `/Me` returns 404 always | Authenticated user model not implemented |
| No `etag.supported:true` | All clients race; document accordingly |

### 9.2 Inverse - what the schema overpromises

| Promise | Verify | Common reality |
|---------|--------|----------------|
| `bulk.supported:true, maxOperations:1000` | Send a bulk of 50 | 501 / 400 / "supported but please don't" |
| `sort.supported:true` | `?sortBy=userName` | Sort is silently ignored |
| `filter.maxResults:200` | `count=200` | Server caps at its own internal limit (e.g. 100) |
| `etag.supported:true` | Look at GET response | No ETag header actually emitted |
| `changePassword.supported:true` | PUT to /Me with password | 405 |
| `patch.supported:true` | PATCH with bracket filter | Only path-less replace works |

The probe harness must verify every advertised capability with a real request.

---

## 10. Lifecycle Probing - the Whole-System Sweep

A single probe says little. The lifecycle of a resource says everything.

### 10.1 The canonical lifecycle

```
1. POST /Users        -> create
2. GET  /Users/{id}   -> read-your-write (consistency check)
3. GET  /Users?filter=userName eq "..."  -> filter consistency
4. PUT  /Users/{id}   -> full replace (note ETag if returned)
5. PATCH /Users/{id} (single op)    -> simple patch
6. PATCH /Users/{id} (multi op)     -> transactional patch
7. PATCH /Users/{id} active=false   -> soft delete
8. GET  /Users/{id}                 -> still returns? (some ISVs hide soft-deleted)
9. GET  /Users?filter=active eq false -> filter on soft-deleted
10. POST /Users with same userName -> reprovision behaviour: 409? new resource? un-soft-delete?
11. PATCH /Users/{id} active=true   -> unsoft-delete
12. DELETE /Users/{id}              -> hard delete
13. GET  /Users/{id}                -> 404 (or 410 if Gone)
14. POST /Users with same userName  -> succeed (ID-recycled? new ID?)
```

Each step's response is a row in a behaviour table. The full table is the ISV's user-lifecycle contract.

### 10.2 Group lifecycle is its own sweep

```
1. POST /Groups
2. PATCH /Groups/{id} add members
3. GET /Groups/{id} -> are members returned inline or only via ?attributes=members?
4. GET /Users/{memberid} -> does User reflect group membership in a `groups` attribute?
5. PATCH /Groups/{id} remove one member
6. PATCH /Groups/{id} replace members []  -> wipe behaviour
7. DELETE /Groups/{id} -> what happens to former members?
```

### 10.3 Cross-lifecycle: User + Group + Membership

```
1. Create User U
2. Create Group G with members[U]
3. DELETE U
4. GET G -> does G still list U? Membership cleanup behaviour
5. POST a different User with same userName as deleted U
6. GET G -> does the new user automatically appear in G? (ID-recycling behaviour)
```

These flows reveal **referential integrity policy** which `/Schemas` never advertises.

---

## 11. Lateral & Speculative Suggestions

Free-form suggestions outside the conventional probe matrix.

### 11.1 Diff your own SCIMServer's profile against the ISV's

If you treat SCIMServer's RFC baseline as the "ideal compliant" profile and the ISV's `/Schemas` as the "actual deployed" profile, a JSON diff between the two is itself a finding catalog. Build a tool that:
1. Fetches `/Schemas` from the ISV.
2. For each attribute, looks up SCIMServer's RFC baseline value for every characteristic.
3. Reports `loosened` / `tightened` / `missing` / `extra` for every attribute.

This is exactly the inverse of SCIMServer's `tighten-only validator` - and it would catch G-6-style differences automatically for any new ISV.

### 11.2 Build a "schema fingerprint" hash

Compute a deterministic hash of the ISV's `/Schemas + /ResourceTypes + /ServiceProviderConfig` (after canonicalising key order). Store it. Any time the hash changes, the vendor shipped a schema change. You're now alerted on schema drift without polling diffs.

### 11.3 Probe via the Microsoft SCIM Validator Logic App

The validator (`logic-scim-validation` in `rg-scim-validation`) IS already a 13-test probe harness. The validation result JSON is rich: 655 actions, per-test pass/fail, per-action timing. Parse it, slice by ISV, and you have a free quarterly compliance report.

### 11.4 Probe via two Entra connectors targeting the same ISV

Configure two Entra apps, each with slightly different attribute mappings, both targeting the same ISV. The differential failure rate isolates which mappings the ISV is happy with. Cheap A/B test.

### 11.5 Watch the OAuth token issuance pattern

If the token endpoint `/oauth/token` issues short-TTL tokens (e.g. 10 min), the server treats provisioning as a sequence of short-lived sessions. If long-TTL (e.g. 30 days), it expects a pinned client. This affects retry logic and connection pooling design.

### 11.6 Probe rate-limit by intentionally tripping it

In a non-prod sandbox, hit the server with 1000 requests/sec and observe:
- When does it 429?
- What's the `Retry-After`?
- Does it honour exponential backoff or fixed?
- Is the limit per-IP or per-token?

Switch to a different OAuth client and repeat - confirms per-client vs global.

### 11.7 Probe write-amplification

Some SCIM servers fan out a single SCIM write to N downstream systems (Exchange, AD, Salesforce). Detect by:
- Round-trip latency curves: if write-then-read consistency is eventual, you'll see lag.
- Look at `meta.lastModified` resolution - if it's millisecond, it's probably synchronous; if minute-truncated, it's probably an async pipeline timestamp.
- Provoke a downstream failure (e.g. user with malformed mailNickname): does the SCIM 200 succeed even though Exchange rejected? That's eventual consistency.

### 11.8 Build a probe-replay corpus from production logs

Sanitize and replay a sample of real Entra->ISV provisioning traffic against your test mock. Anything the mock 400s but production 201ed is a fidelity gap. Anything the mock 201s but production 400ed is the gap of the day (this is exactly the OpenText case in [OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md §10](OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md)).

### 11.9 Use property-based testing (Hypothesis / fast-check) on the ISV

Generate 10K random-but-schema-valid SCIM payloads and POST them. Bucket by status code. The boundary between 200 and 400 is the de-facto unwritten format spec. From the boundary, you can often reverse-engineer the regex / validator by reduction: take a failing input, remove fields one-by-one, find the minimal failing case.

### 11.10 Cross-domain inspiration

| Domain | Borrow this |
|--------|-------------|
| Web fuzzing (OWASP ZAP, Burp) | Header / payload mutation engines |
| Database driver compatibility tests (JDBC TCK style) | Per-feature pass/fail matrix as the deliverable |
| Browser interop (Acid3) | Single-number compliance score that names-and-shames |
| TLS interop suite (e.g. testssl.sh) | Long-running probe corpus that runs nightly |
| LDAP interop (RFC 4530 conformance) | Negative-test categorisation we already have a model for |
| GraphQL introspection (`__schema`) | Compare to SCIM `/Schemas` - GraphQL is way richer; learn from it |
| Open Banking / FAPI conformance | Multi-stage flow probes (auth -> issuance -> reconciliation) |
| DNS interop tests (zonemaster.iis.se) | Independent re-implementation that diffs |

### 11.11 The one-page "ISV onboarding readiness" checklist

After running the full probe suite, output a single page with:
- Compliance score (RFC alignment percentage)
- Capability matrix (per-feature green/yellow/red)
- Vendor-specific quirks list
- Performance characteristics
- Known sad-paths
- Recommended Entra mapping overrides

This is what an account manager actually needs. The 1000-line probe-result JSON is for engineers; the one-page summary is for decision-makers.

### 11.12 Continuous probing ("schema canary")

Run a tiny subset of the probe suite (10 cheap probes) every hour against the ISV's prod endpoint. Alert on:
- Status code change for any probe
- Response shape change
- Latency p95 jumping > 2x baseline
- New header appearing
- ETag format change
- New scimType keyword appearing in errors

This turns every silent vendor upgrade into a known event.

### 11.13 Embed the probe corpus into SCIMServer itself

SCIMServer is a SCIM server. It could ALSO be a SCIM client that validates other SCIM servers. Add a `POST /admin/probe` admin route that takes a target URL + bearer and runs the probe corpus against it, returning the per-probe outcome. Now every SCIMServer deployment is a probe runner. This turns SCIMServer from "tool to mock ISVs" into "tool to mock ISVs + tool to characterise real ISVs".

### 11.14 The reverse-mock idea

Take an ISV's recorded HTTP traffic (from a Logic App run, or a Postman collection, or a captured Entra provisioning cycle). Generate a synthetic SCIMServer endpoint profile that **deliberately reproduces every observed quirk** (including the 400s with their exact correlation-ID format and `scimType` keywords). This becomes a high-fidelity replay mock that's better than the schema for catching downstream client bugs.

### 11.15 Probe the change-password / sign-in flow

If `/ServiceProviderConfig.changePassword.supported:true`:
- PATCH `/Me` with a password
- Try to sign in with the new password
- Probe password complexity rules (the schema doesn't carry them; the failing 400 messages do)

This bridges SCIM into the broader auth surface.

### 11.16 Telemetry-driven gap discovery

Instrument SCIMServer (or Entra connector) to emit one telemetry event per request to the ISV: `{path, method, status, scimType, durationMs, correlationId}`. Aggregate over a week. Patterns surface:
- Top scimType keywords (= top failure modes)
- Endpoints with bimodal latency (= caching boundary)
- Status-code distribution per endpoint (= reliability profile)

These patterns guide where to deepen the probe corpus.

### 11.17 Provoke specific RFC behaviours

Some RFC text only triggers on specific shapes:
- RFC 7644 §3.5.2.4 - PATCH op with empty `value` -> SHALL be a removal signal. Probe.
- RFC 7644 §3.4.3 - filter on multi-valued must implicitly use `pr` semantics. Probe.
- RFC 7643 §2.5 - reference attribute MUST be a URI. Probe with a bare ID.
- RFC 7643 §2.4 - max one `primary:true` per multi-valued. Probe with two.
- RFC 7644 §3.7.1 - bulk operation order matters when bulkId references resolve. Probe.

For each MUST/SHOULD in both RFCs, write a single probe. There are roughly 80 of them in 7643+7644 - that's a finite corpus.

### 11.18 Don't forget the read-only / report side

`GET /Users` with `count=0` returns `totalResults` only. That's a free **resource census probe**. Hit it daily and graph the count - reveals provisioning velocity, ISV scale, and any sudden drops (mass deletes, bugs).

### 11.19 The "schema-by-correspondence" technique

If you can talk to the ISV's product team, ask for their internal data model document (LDAP schema, ER diagram, Snowflake column list). Map each internal attribute to a SCIM attribute. Anything in their internal model that doesn't map is a candidate custom extension. Anything in SCIM that doesn't map is an attribute the server probably accepts-but-ignores (silent drop) - and that's a high-risk integration surprise.

### 11.20 Treat the probe corpus as a SaaS

Your probe corpus + harness + rendered reports become an internal SaaS that any team integrating a new ISV consumes:
- Self-service: paste an ISV URL + bearer, get a compliance report in 10 min.
- Differential: re-run weekly, alert on changes.
- Catalog: every ISV you've onboarded has a permanent profile page.

This scales the methodology from "one engineer learns one ISV" to "every engineer benefits from every ISV ever profiled".

---

## 12. Applied - what these techniques would tell us about OpenText / AppRiver

Quickly cross-referencing the techniques to the OpenText evidence in [OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md](OPENTEXT_ISV_1_VALIDATION_GAP_ANALYSIS.md):

| Technique | What we already learned | What we should still run |
|-----------|------------------------|---------------------------|
| L1: Discovery | 3 schemas, 3 resource types (User+EnterpriseUser+Group), strict canonical on emails.type / phoneNumbers.type / addresses.type, no `bulk` advertised | Confirm `/ServiceProviderConfig` etag.supported value; confirm `/Schemas/{urn}` per-URN works |
| L2: Round-trip | Validator's POST → 201; Kusto-captured GET shows server normalisation | Run our own POST + GET diff to capture canonicalisation rules |
| L2: Boundary | Bot test exposed format-strictness on phones / country / postalCode | Per-attribute boundary scan to enumerate format rules |
| L2: Filter matrix | Validator confirmed `displayName eq` works on Group | Run full operator matrix on User; especially `co` / `sw` / bracket filters |
| L2: PATCH probe | Validator passed `Update_User_Test`, `Disable_User_Test` -> top-level PATCH works | Probe extension URN paths, bracket filters, multi-op transactional behaviour |
| L3: Headers | Confirmed `X-Powered-By: ASP.NET`, `Transfer-Encoding: chunked`, no Server header (LB stripping) | Look for X-RateLimit, ETag, WWW-Authenticate |
| L3: Location header | Leaked internal hostname `scim.apps.appriver.corp` - corp-internal LDAP-style | Run cert-transparency lookup on `*.appriver.corp` |
| L3: Body shape | DateTime is .NET 7-digit-fractional; UUID lowercase | (matched .NET stack inference) |
| L3: Latency | 51 minutes for 13 validator tests = ~4 min/test, indicating slow or queued downstream | Run latency burst test |
| L4: OAuth token | Decoded - reveals `BosunClaims` scope, customer ID format, partner-tenant model | (already done) |
| L4: Connector config | Reveals join key = userName; mapping for 17 specific attributes | (already mined) |
| L4: Vendor docs | Not yet mined | Read AppRiver's customer portal docs for allowed mailNickname / domain rules |
| L5: Triangulation | Validator passes 12/13; bot fails differently | Run identical probe corpus against Okta SCIM + Workday and diff |
| L6: Adversarial | Bot accidentally did this with random data | Formal chaos sweep recommended |
| L9: Negative-space | No `manager` in EnterpriseUser → flat org model; no `password` → federated auth | (already inferred) |
| L11.4: A/B Entra apps | Not done | Run a second app with different mappings for differential signal |
| L11.7: Write amplification | Not measured | Time write-vs-read consistency; AppRiver clearly fans out to Exchange |
| L11.9: Property-based | Not done | Generate 10K schema-valid random payloads, find the boundary that 400s |

The point: **even one ISV deserves a 50+ probe sweep across all six layers**. Today we ran maybe 10. The OPENTEXT_ISV_1 doc is a great start but only scratches L1+L2.

---

## 13. Roadmap for SCIMServer to ship probing as a first-class capability

This is genuinely a new product capability for SCIMServer, not just an internal tool. Suggested phasing:

| Phase | Deliverable | Effort | Value |
|-------|-------------|--------|-------|
| **P-1: Probe corpus** | YAML probe spec + 80 probes covering every RFC MUST/SHOULD | 3 days | Reusable test corpus |
| **P-2: Probe runner CLI** | `scim-probe --target <url> --bearer <token> --corpus rfc-baseline.yaml` | 2 days | Internal tool ready |
| **P-3: Probe report generator** | HTML + JSON reports with compliance score | 1 day | Account-manager-ready output |
| **P-4: Schema-fingerprint canary** | Hash + diff-alert on `/Schemas + /ResourceTypes + /ServiceProviderConfig` change | 1 day | Free schema-drift detection |
| **P-5: Built-in probe in SCIMServer admin UI** | "Probe this ISV" button on a new admin page | 3 days | Zero-friction adoption |
| **P-6: Property-based fuzzer** | fast-check generator for schema-valid random payloads + boundary classifier | 4 days | Auto-discovers format rules |
| **P-7: Differential corpus runner** | Run corpus against N ISVs in parallel, generate diff matrix | 2 days | Cross-vendor quirk catalog |
| **P-8: Replay harness** | Take captured prod traffic, replay against any target | 3 days | Safe migration testing |
| **P-9: BusinessRules profile extension** | New `profile.businessRules` section in SCIMServer profiles for high-fidelity ISV mocks | 5 days | Closes the format-rules fidelity gap (G-7 in OpenText doc) |
| **P-10: Continuous probing service** | Hourly mini-corpus + alert on regression | 2 days | Production-grade canary |

Total: ~26 engineer-days for a complete probing suite. This single deliverable would change Microsoft Entra's ISV onboarding from "1-2 weeks of human discovery per ISV" to "one button + 10 minutes of automated discovery + 1 day of human review of the report".

---

## Appendix A - Probe corpus seed (YAML, abbreviated)

```yaml
# rfc-7644-must-corpus.yaml - one probe per MUST in RFC 7644

- id: rfc7644-3.3.must-201-on-create
  rfc: '7644 §3.3'
  description: Server MUST return 201 Created on successful resource creation
  request: { method: POST, path: /Users, body: $minimalUser }
  expect: { status: 201 }

- id: rfc7644-3.3.must-location-on-create
  rfc: '7644 §3.3'
  description: Server MUST return Location header on successful create
  request: { method: POST, path: /Users, body: $minimalUser }
  expect: { headers.Location: /^https?:\/\// }

- id: rfc7644-3.4.2.2.must-and-binds-tighter
  rfc: '7644 §3.4.2.2'
  description: AND has higher precedence than OR
  setup: { create: 3 users with carefully chosen attributes }
  request:
    method: GET
    path: /Users
    query: { filter: 'a eq 1 and b eq 2 or c eq 3' }
  expect: { body.totalResults: $exactlyTwo }

- id: rfc7644-3.5.2.must-pass-on-readonly-patch
  rfc: '7644 §3.5.2 + 7643 §2.2'
  description: Server SHALL ignore readOnly attributes in PATCH (or 400 if strict)
  setup: { create: user, record_as: u }
  request:
    method: PATCH
    path: /Users/{{u.id}}
    body:
      schemas: ['urn:...:PatchOp']
      Operations: [{ op: replace, path: id, value: 'newId' }]
  expect:
    status_in: [200, 400]
  classify:
    on-status-200: ignored-readonly
    on-status-400: rejected-readonly

# ... ~80 more probes total
```

---

## Appendix B - One-shot diagnostic script (skeleton)

```powershell
# probe-isv.ps1 - drop-in basic diagnostic for any ISV SCIM endpoint
param(
    [Parameter(Mandatory=$true)] [string] $BaseUrl,
    [Parameter(Mandatory=$true)] [string] $Bearer
)

$h = @{ Authorization = "Bearer $Bearer"; Accept = "application/scim+json" }
$base = $BaseUrl.TrimEnd('/')
$results = @()

foreach ($path in @('/ServiceProviderConfig','/ResourceTypes','/Schemas')) {
    $r = Invoke-WebRequest -Uri "$base$path" -Headers $h -SkipHttpErrorCheck
    $results += [pscustomobject]@{
        probe       = "discovery-$path"
        status      = $r.StatusCode
        contentType = $r.Headers['Content-Type']
        server      = $r.Headers['Server']
        powered     = $r.Headers['X-Powered-By']
        bytes       = $r.RawContentLength
    }
}

# Round-trip
$body = @{
    schemas  = @('urn:ietf:params:scim:schemas:core:2.0:User')
    userName = "probe-$([guid]::NewGuid().ToString('N').Substring(0,8))@probe.test"
    name     = @{ givenName = 'Probe'; familyName = 'User' }
} | ConvertTo-Json -Depth 4

$create = Invoke-WebRequest -Uri "$base/Users" -Method POST -Headers $h -ContentType 'application/scim+json' -Body $body -SkipHttpErrorCheck
$results += [pscustomobject]@{
    probe       = 'roundtrip-create'
    status      = $create.StatusCode
    location    = $create.Headers['Location']
    etag        = $create.Headers['ETag']
    serverDate  = $create.Headers['Date']
    correlation = $create.Headers['X-Request-Id']
}

# Boundary: bad canonical
$bad = $body | ConvertFrom-Json
$bad.userName = "probe-canonical-$([guid]::NewGuid().ToString('N').Substring(0,8))@probe.test"
$bad | Add-Member emails @(@{ value = 'x@y.com'; type = 'NOT-A-CANONICAL-VALUE' })
$badRes = Invoke-WebRequest -Uri "$base/Users" -Method POST -Headers $h -ContentType 'application/scim+json' -Body ($bad | ConvertTo-Json -Depth 4) -SkipHttpErrorCheck
$results += [pscustomobject]@{
    probe = 'boundary-canonical-violation'
    status = $badRes.StatusCode
    bodySnippet = ($badRes.Content -replace "`n", '').Substring(0, [Math]::Min(200, $badRes.Content.Length))
}

$results | Format-Table -AutoSize
```

This single script is a credible first iteration of P-2. Builds in minutes. Worth doing for every ISV before committing engineering effort to integration.

---

## Closing thought

SCIM 2.0 is not self-describing. It's only schema-describing. The full contract of any real ISV endpoint is the schema **plus** every undocumented format rule, allow-list, sequencing requirement, idempotency expectation, error vocabulary, latency profile, and out-of-band convention the vendor accumulated over years. Discovery returns the first part. **Everything in this document is the methodology for harvesting the rest.**
