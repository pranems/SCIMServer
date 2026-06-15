# OAuth / WIF assertion RFC mirror

Authoritative plain-text copies of the IETF RFCs that the Workload Identity Federation (WIF) design depends on. They are mirrored here so the normative source travels with the design docs and can be cited line-for-line without a network round-trip (datatracker.ietf.org returns HTTP 403 to automated fetch; these were retrieved from `www.rfc-editor.org`).

| File | RFC | Title | Role in WIF | Explainer |
|---|---|---|---|---|
| [rfc7521.txt](rfc7521.txt) | RFC 7521 | Assertion Framework for OAuth 2.0 Client Authentication and Authorization Grants | The umbrella framework RFC 7523 profiles | - |
| [rfc7523.txt](rfc7523.txt) | RFC 7523 | JWT Profile for OAuth 2.0 Client Authentication and Authorization Grants | The `jwt-bearer` profile (today's WIF; SuccessFactors) | [../RFC_7523_EXPLAINED.md](../RFC_7523_EXPLAINED.md) |
| [rfc8693.txt](rfc8693.txt) | RFC 8693 | OAuth 2.0 Token Exchange | The `token-exchange` profile (upcoming WIF; Google) | [../RFC_8693_EXPLAINED.md](../RFC_8693_EXPLAINED.md) |

## Provenance

- Retrieved 2026-06-15 from `https://www.rfc-editor.org/rfc/rfc<NNNN>.txt`.
- These are verbatim RFC text files. Do not edit them; they are the authoritative reference. All commentary lives in the `*_EXPLAINED.md` docs and in [../WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md](../WIF_JWT_BEARER_ASSERTION_FOR_SCIM.md).

## Related but not mirrored

These are referenced by the WIF design but not copied in (they are stable and widely available online):

- RFC 7519 - JSON Web Token (JWT)
- RFC 7517 - JSON Web Key (JWK)
- RFC 6749 - The OAuth 2.0 Authorization Framework
- RFC 7644 - SCIM Protocol
- RFC 7662 - OAuth 2.0 Token Introspection (defines where `act` / `may_act` also appear)

## SCIM core RFCs

The SCIM core RFCs (7642 / 7643 / 7644) live separately under [../../rfcs/](../../rfcs/README.md).
