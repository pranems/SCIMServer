# OAuth / WIF / OIDC RFC mirror

Authoritative plain-text copies of the IETF RFCs that the SCIMServer authentication design depends on. They are mirrored here so the normative source travels with the design docs and can be cited line-for-line without a network round-trip (datatracker.ietf.org returns HTTP 403 to automated fetch; these were retrieved from `www.rfc-editor.org`). Each load-bearing RFC has a companion plain-language explainer (`RFC_<NNNN>_EXPLAINED.md`).

> **The umbrella that ties these together is [../AUTHENTICATION_ARCHITECTURE.md](../AUTHENTICATION_ARCHITECTURE.md).** Start there for how the pieces compose; use the explainers for one RFC at a time; use the `.txt` mirrors for the normative wording.

## Foundations (OAuth core + token usage)

| File | RFC | Title | Role | Explainer |
|---|---|---|---|---|
| [rfc6749.txt](rfc6749.txt) | RFC 6749 | The OAuth 2.0 Authorization Framework | The foundational spec - token endpoint, grant types, scope, error catalog (section 5.2) | [RFC_6749_EXPLAINED.md](RFC_6749_EXPLAINED.md) |
| [rfc6750.txt](rfc6750.txt) | RFC 6750 | OAuth 2.0 Bearer Token Usage | How a bearer token is presented; the `WWW-Authenticate` challenge (section 3) | [RFC_6750_EXPLAINED.md](RFC_6750_EXPLAINED.md) |

## JOSE (token + key formats)

| File | RFC | Title | Role | Explainer |
|---|---|---|---|---|
| [rfc7519.txt](rfc7519.txt) | RFC 7519 | JSON Web Token (JWT) | The token format Entra signs, SCIMServer validates and issues | [RFC_7519_EXPLAINED.md](RFC_7519_EXPLAINED.md) |
| [rfc7517.txt](rfc7517.txt) | RFC 7517 | JSON Web Key (JWK) | The JWK / JWKS that supplies verification keys by `kid` | [RFC_7517_EXPLAINED.md](RFC_7517_EXPLAINED.md) |

## Discovery + registration

| File | RFC | Title | Role | Explainer |
|---|---|---|---|---|
| [rfc8414.txt](rfc8414.txt) | RFC 8414 | OAuth 2.0 Authorization Server Metadata | The `.well-known` doc advertising `token_endpoint` / `jwks_uri` so the path is discovered, not guessed | [RFC_8414_EXPLAINED.md](RFC_8414_EXPLAINED.md) |
| [rfc7591.txt](rfc7591.txt) | RFC 7591 | OAuth 2.0 Dynamic Client Registration | The `token_endpoint_auth_method` registry SCIMServer's provider `type`s map onto | [RFC_7591_EXPLAINED.md](RFC_7591_EXPLAINED.md) |

## Assertion + token exchange (the WIF carriers)

| File | RFC | Title | Role | Explainer |
|---|---|---|---|---|
| [rfc7521.txt](rfc7521.txt) | RFC 7521 | Assertion Framework for OAuth 2.0 | The umbrella RFC 7523 / 8693 profile | [RFC_7521_EXPLAINED.md](RFC_7521_EXPLAINED.md) |
| [rfc7523.txt](rfc7523.txt) | RFC 7523 | JWT Profile for OAuth 2.0 Client Authentication and Authorization Grants | The `jwt-bearer` profile (today's WIF; SuccessFactors) | [RFC_7523_EXPLAINED.md](RFC_7523_EXPLAINED.md) |
| [rfc8693.txt](rfc8693.txt) | RFC 8693 | OAuth 2.0 Token Exchange | The `token-exchange` profile (upcoming WIF; Google) | [RFC_8693_EXPLAINED.md](RFC_8693_EXPLAINED.md) |

## Sender-constrained tokens + security baseline (future-phase)

| File | RFC | Title | Role | Explainer |
|---|---|---|---|---|
| [rfc7636.txt](rfc7636.txt) | RFC 7636 | Proof Key for Code Exchange (PKCE) | Protects the authorization-code grant (Phase Q4 only) | [RFC_7636_EXPLAINED.md](RFC_7636_EXPLAINED.md) |
| [rfc8705.txt](rfc8705.txt) | RFC 8705 | OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens | mTLS client auth + cert-bound tokens (Phase Q5, deferred) | [RFC_8705_EXPLAINED.md](RFC_8705_EXPLAINED.md) |
| [rfc9449.txt](rfc9449.txt) | RFC 9449 | OAuth 2.0 Demonstrating Proof of Possession (DPoP) | App-layer sender-constrained tokens (Phase Q5, deferred) | [RFC_9449_EXPLAINED.md](RFC_9449_EXPLAINED.md) |
| [rfc9700.txt](rfc9700.txt) | RFC 9700 | Best Current Practice for OAuth 2.0 Security | The security baseline (OAuth 2.1) the whole design conforms to | [RFC_9700_EXPLAINED.md](RFC_9700_EXPLAINED.md) |

## Provenance

- Retrieved 2026-06-15 (7521 / 7523 / 8693) and 2026-06-18 (all others) from `https://www.rfc-editor.org/rfc/rfc<NNNN>.txt`.
- These are verbatim RFC text files. **Do not edit them**; they are the authoritative reference. All commentary lives in the `*_EXPLAINED.md` docs and in [../WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md](../WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md) / [../AUTHENTICATION_ARCHITECTURE.md](../AUTHENTICATION_ARCHITECTURE.md).

## Referenced but not mirrored

These are cited by the design but not copied in (stable, widely available, or owned by another doc set):

- RFC 7515 (JWS) / RFC 7516 (JWE) / RFC 7518 (JWA) - the JOSE signing/encryption/algorithm mechanics under JWT/JWK.
- RFC 7522 - the SAML 2.0 sibling of RFC 7523 (not used by WIF).
- RFC 7662 - OAuth 2.0 Token Introspection (also defines where `act` / `may_act` appear).
- RFC 7617 - HTTP Basic auth (the `httpbasic` SCIM scheme, deliberately not designed).

## SCIM core RFCs

The SCIM core RFCs (7642 / 7643 / 7644) live separately under [../../rfcs/](../../rfcs/README.md).
