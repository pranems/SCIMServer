/**
 * RFC 6749 section 2.3.1 - client credential location on the token endpoint.
 *
 * A confidential client may present its `client_id` / `client_secret` in one of
 * two locations:
 *
 *  - `client_secret_basic`: the HTTP `Authorization: Basic base64(id:secret)`
 *    header (RFC 6749 section 2.3.1, the RECOMMENDED form);
 *  - `client_secret_post`: the request body as form parameters (also allowed).
 *
 * Microsoft Entra's newer "OAuth2 client credentials grant" provisioning
 * experience sends the credentials in the `Authorization: Basic` header and
 * fails the connection test with `CredentialValidationUnavailable` /
 * "Supported CredentialLocationInRequest is required" when the token endpoint
 * only reads the body. Accepting BOTH locations makes the endpoint compatible
 * with Entra, Okta, Ping, and any RFC-6749 client regardless of where they put
 * the credentials.
 *
 * This helper extracts the credentials from the Basic header when present. Body
 * parameters always take precedence when they are supplied, so an explicit
 * body value is never silently overridden by a header.
 */
export interface ClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

/**
 * Parse an `Authorization: Basic ...` header into `client_id` / `client_secret`.
 * Returns an empty object when the header is missing, malformed, or not Basic.
 * Per RFC 6749 section 2.3.1 both the id and the secret are
 * `application/x-www-form-urlencoded`-encoded before base64 encoding, so we
 * URL-decode each half after splitting on the first colon.
 */
export function parseBasicAuthHeader(authorization?: string): ClientCredentials {
  if (!authorization || typeof authorization !== 'string') {
    return {};
  }

  const match = /^Basic\s+(.+)$/i.exec(authorization.trim());
  if (!match) {
    return {};
  }

  let decoded: string;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return {};
  }

  const sep = decoded.indexOf(':');
  if (sep < 0) {
    return {};
  }

  const rawId = decoded.slice(0, sep);
  const rawSecret = decoded.slice(sep + 1);

  const safeDecode = (v: string): string => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };

  return {
    clientId: safeDecode(rawId),
    clientSecret: safeDecode(rawSecret),
  };
}

/**
 * Resolve the effective client credentials from the body (`client_secret_post`)
 * and the `Authorization` header (`client_secret_basic`). Body values win when
 * present; header values fill the gaps.
 */
export function resolveClientCredentials(
  body: ClientCredentials,
  authorization?: string,
): ClientCredentials {
  const fromHeader = parseBasicAuthHeader(authorization);
  return {
    clientId: body.clientId || fromHeader.clientId,
    clientSecret: body.clientSecret || fromHeader.clientSecret,
  };
}
