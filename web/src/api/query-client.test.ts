import { beforeEach, describe, expect, it } from 'vitest';
import { clearStoredToken, setStoredToken } from '../auth/token';
import { clearCredentialRevealCache, queryClient } from './query-client';

describe('credential reveal query cache', () => {
  beforeEach(() => {
    queryClient.clear();
    window.localStorage.clear();
  });

  it('removes plaintext reveal results when the auth token changes', () => {
    queryClient.setQueryData(
      ['connection-reveal', 'endpoint-1', 'credential-1'],
      { retained: true, clientSecret: 'session-one-secret' },
    );
    queryClient.setQueryData(['endpoint', 'endpoint-1'], { id: 'endpoint-1' });

    setStoredToken('session-two-token');

    expect(queryClient.getQueryData(['connection-reveal', 'endpoint-1', 'credential-1'])).toBeUndefined();
    expect(queryClient.getQueryData(['endpoint', 'endpoint-1'])).toEqual({ id: 'endpoint-1' });
  });

  it('also clears reveal results on logout and through the explicit helper', () => {
    queryClient.setQueryData(['connection-reveal', 'endpoint-1', 'credential-1'], { token: 'secret' });
    clearStoredToken();
    expect(queryClient.getQueryData(['connection-reveal', 'endpoint-1', 'credential-1'])).toBeUndefined();

    queryClient.setQueryData(['connection-reveal', 'endpoint-1', 'credential-2'], { token: 'secret-2' });
    clearCredentialRevealCache();
    expect(queryClient.getQueryData(['connection-reveal', 'endpoint-1', 'credential-2'])).toBeUndefined();
  });
});
