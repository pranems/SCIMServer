import type { SpcAuthenticationScheme, ProfileAuthentication, AuthenticationMethod } from '../endpoint-profile/endpoint-profile.types';

/**
 * A2 - compute the `authenticationSchemes` advertised in an endpoint's
 * `/ServiceProviderConfig` from its enabled authentication methods.
 *
 * The baseline scheme (`oauthbearertoken`) is ALWAYS present - the legacy /
 * bearer / OAuth-JWT acceptor chain always works, so discovery must always
 * advertise it. Each ENABLED method in `profile.authentication.methods[]` adds
 * its own scheme (mapped from the method `type` to the RFC 7643 section 5
 * `authenticationScheme.type` vocabulary). `primary:true` is placed on the
 * scheme of the method named by `defaultMethodId`; otherwise the baseline stays
 * primary.
 *
 * An endpoint with no enabled methods advertises ONLY the baseline.
 */

/** Map an authentication-method `type` to its RFC 7643 §5 scheme `type`. */
const METHOD_TYPE_TO_SCHEME_TYPE: Record<string, SpcAuthenticationScheme['type']> = {
  'shared-secret': 'oauthbearertoken',
  bearer: 'oauthbearertoken',
  'oauth-client': 'oauth2',
  'external-jwt': 'oauth2',
  'wif-7523': 'oauth2',
  'wif-8693': 'oauth2',
  'oauth-authcode': 'oauth2',
  mtls: 'oauth2',
  dpop: 'oauth2',
  httpbasic: 'httpbasic',
};

const SCHEME_NAME_BY_TYPE: Record<string, string> = {
  oauth2: 'OAuth 2.0',
  oauthbearertoken: 'OAuth Bearer Token',
  httpbasic: 'HTTP Basic',
};

function methodToScheme(method: AuthenticationMethod): SpcAuthenticationScheme {
  const schemeType = METHOD_TYPE_TO_SCHEME_TYPE[method.type] ?? 'oauth2';
  const scheme: SpcAuthenticationScheme = {
    type: schemeType,
    name: method.displayName ?? SCHEME_NAME_BY_TYPE[schemeType] ?? method.type,
    description: method.description ?? `Authentication via the "${method.type}" method.`,
  };
  if (method.specUri) scheme.specUri = method.specUri;
  return scheme;
}

/**
 * Compute the advertised authentication schemes.
 *
 * @param baseline The deployment baseline scheme(s) (always the
 *   `oauthbearertoken` scheme). Cloned so the input is never mutated.
 * @param authentication The endpoint's authentication block (optional).
 */
export function computeAuthenticationSchemes(
  baseline: readonly SpcAuthenticationScheme[],
  authentication?: ProfileAuthentication,
): SpcAuthenticationScheme[] {
  // Always start from a clone of the baseline; reset primary flags - we set
  // exactly one primary below.
  const baselineClones = baseline.map((s) => ({ ...s, primary: false }));

  const enabled = (authentication?.methods ?? []).filter((m) => m.enabled !== false);
  if (enabled.length === 0) {
    // Disabled / no methods: baseline only, baseline is primary.
    if (baselineClones.length > 0) baselineClones[0].primary = true;
    return baselineClones;
  }

  const schemes: SpcAuthenticationScheme[] = [...baselineClones];
  const schemeByMethodId = new Map<string, SpcAuthenticationScheme>();
  for (const method of enabled) {
    const scheme = { ...methodToScheme(method), primary: false };
    schemes.push(scheme);
    schemeByMethodId.set(method.id, scheme);
  }

  // primary:true on the defaultMethodId scheme; else the baseline stays primary.
  const defaultScheme = authentication?.defaultMethodId
    ? schemeByMethodId.get(authentication.defaultMethodId)
    : undefined;
  if (defaultScheme) {
    defaultScheme.primary = true;
  } else if (baselineClones.length > 0) {
    baselineClones[0].primary = true;
  }

  return schemes;
}
