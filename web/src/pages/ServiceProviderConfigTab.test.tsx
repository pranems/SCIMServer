import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ServiceProviderConfigTab } from './ServiceProviderConfigTab';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointServiceProviderConfig: vi.fn(),
  };
});

import { useEndpointServiceProviderConfig } from '../api/queries';

describe('ServiceProviderConfigTab', () => {
  it('renders endpoint capabilities, limits, authentication schemes, and raw JSON', () => {
    (useEndpointServiceProviderConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
        documentationUri: 'https://example.test/scim-docs',
        patch: { supported: true },
        filter: { supported: true, maxResults: 250 },
        etag: { supported: true },
        bulk: { supported: true, maxOperations: 100, maxPayloadSize: 1048576 },
        changePassword: { supported: false },
        sort: { supported: true },
        authenticationSchemes: [{
          type: 'oauthbearertoken',
          name: 'OAuth bearer token',
          primary: true,
          description: 'Endpoint-scoped OAuth access token.',
          documentationUri: 'https://example.test/oauth',
        }],
      },
      isLoading: false,
      error: null,
    });

    render(
      <FluentProvider theme={webLightTheme}>
        <ServiceProviderConfigTab endpointId="ep-1" />
      </FluentProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Service Provider Config' })).toBeInTheDocument();
    expect(screen.getByTestId('spc-capability-filter')).toHaveTextContent('250 resources');
    expect(screen.getByTestId('spc-capability-bulk')).toHaveTextContent('100 operations');
    expect(screen.getByTestId('spc-capability-bulk')).toHaveTextContent('1 MiB');
    expect(screen.getByText('OAuth bearer token')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByTestId('spc-json-copy-button')).toBeInTheDocument();
  });
});