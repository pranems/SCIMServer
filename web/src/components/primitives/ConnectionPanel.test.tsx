import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ConnectionPanel } from './ConnectionPanel';
import type { ConnectionInfo } from '@scim/types/connection-info.types';

const renderWithFluent = (ui: React.ReactElement): ReturnType<typeof render> =>
  render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

const ID = '7e3f9c21-9a4b-4c6e-8f12-2a5d9b0e1c34';

function info(over: Partial<ConnectionInfo> = {}): ConnectionInfo {
  return {
    endpointId: ID,
    displayName: 'Onboarding-ISV',
    urls: {
      scimBaseUrl: `https://scim.example.com/scim/v2/endpoints/${ID}`,
      scimBaseUrlBare: `https://scim.example.com/scim/endpoints/${ID}`,
      tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
      serviceProviderConfig: `https://scim.example.com/scim/v2/endpoints/${ID}/ServiceProviderConfig`,
      oauthMetadata: `https://scim.example.com/scim/endpoints/${ID}/.well-known/oauth-authorization-server`,
    },
    enabledMethods: [
      {
        method: 'oauth_client',
        label: 'OAuth2 client credentials',
        entraAuthenticationMethod: 'OAuth2 Client Credentials Grant',
        entraFields: {
          tenantUrl: `https://scim.example.com/scim/v2/endpoints/${ID}`,
          tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
          clientIdentifier: 'epc_abc123',
          clientSecret: null,
        },
        clientSecretState: 'set-shown-once',
      },
      {
        method: 'wif',
        label: 'Workload Identity Federation',
        entraAuthenticationMethod: 'OAuth2 Client Credentials Grant',
        entraFields: {
          tenantUrl: `https://scim.example.com/scim/v2/endpoints/${ID}`,
          tokenEndpoint: `https://scim.example.com/scim/endpoints/${ID}/oauth/token`,
        },
        clientSecretState: 'none',
        expectedAudience: `api://scimserver/${ID}`,
      },
    ],
    disabledMethods: [
      { method: 'bearer', reason: 'x', enableHint: 'y' },
    ],
    ...over,
  };
}

describe('ConnectionPanel (WI-4)', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders a radio per enabled method + the copy-all-JSON button', () => {
    renderWithFluent(<ConnectionPanel connectionInfo={info()} />);
    expect(screen.getByTestId('connection-panel')).toBeInTheDocument();
    expect(screen.getByTestId('connection-panel-method-oauth_client')).toBeInTheDocument();
    expect(screen.getByTestId('connection-panel-method-wif')).toBeInTheDocument();
    expect(screen.getByTestId('connection-panel-copy-json')).toBeInTheDocument();
  });

  it('shows the first enabled method fields by default (oauth_client)', () => {
    renderWithFluent(<ConnectionPanel connectionInfo={info()} />);
    expect(screen.getByTestId('connection-panel-value-tenantUrl')).toBeInTheDocument();
    expect(screen.getByTestId('connection-panel-value-clientIdentifier')).toHaveTextContent('epc_abc123');
    // Secret is not shown -> placeholder for set-shown-once.
    expect(screen.getByTestId('connection-panel-secret-placeholder')).toHaveTextContent('Shown once at creation');
  });

  it('switches fields when a different method is selected', () => {
    renderWithFluent(<ConnectionPanel connectionInfo={info()} />);
    // Select WIF.
    fireEvent.click(screen.getByTestId('connection-panel-method-wif'));
    // WIF has no clientIdentifier but does surface an expected audience.
    expect(screen.queryByTestId('connection-panel-value-clientIdentifier')).not.toBeInTheDocument();
    expect(screen.getByTestId('connection-panel-value-expectedAudience')).toHaveTextContent(`api://scimserver/${ID}`);
  });

  it('renders the one-time secret + warning when oneTimeSecret matches the method', () => {
    renderWithFluent(
      <ConnectionPanel
        connectionInfo={info()}
        oneTimeSecret={{ method: 'oauth_client', secret: 's3cr3t-shown-once' }}
      />,
    );
    expect(screen.getByTestId('connection-panel-value-clientSecret')).toHaveTextContent('s3cr3t-shown-once');
    expect(screen.getByTestId('connection-panel-secret-warning')).toBeInTheDocument();
  });

  it('copy-as-.env writes SCIM_* lines to the clipboard', () => {
    renderWithFluent(<ConnectionPanel connectionInfo={info()} />);
    fireEvent.click(screen.getByTestId('connection-panel-copy-env'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const payload = writeText.mock.calls[0][0] as string;
    expect(payload).toContain('SCIM_TENANT_URL=https://scim.example.com/scim/v2/endpoints/');
    expect(payload).toContain('SCIM_CLIENT_ID=epc_abc123');
  });

  it('renders an empty state when no method is enabled', () => {
    renderWithFluent(<ConnectionPanel connectionInfo={info({ enabledMethods: [] })} />);
    expect(screen.getByTestId('connection-panel-no-methods')).toBeInTheDocument();
    expect(screen.queryByTestId('connection-panel-method-selector')).not.toBeInTheDocument();
  });

  it('shows a create-required placeholder when the secret was never created', () => {
    const ci = info();
    ci.enabledMethods[0].clientSecretState = 'create-required';
    renderWithFluent(<ConnectionPanel connectionInfo={ci} />);
    expect(screen.getByTestId('connection-panel-secret-placeholder')).toHaveTextContent('Create a credential');
  });
});
