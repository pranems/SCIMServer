/**
 * ConnectTab tests (WI-5) - the per-endpoint Connect tab that renders the
 * ConnectionPanel from the WI-3 overview.connectionInfo.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ConnectTab } from './ConnectTab';
import { FIXTURE_ENDPOINT_OVERVIEW } from '../test/msw/fixtures';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: vi.fn(),
    useConnectionRetainedSecrets: vi.fn(() => ({})),
  };
});

import { useEndpointOverview, useConnectionRetainedSecrets } from '../api/queries';

const renderTab = (): ReturnType<typeof render> =>
  render(
    <FluentProvider theme={webLightTheme}>
      <ConnectTab endpointId="ep-msw-1" />
    </FluentProvider>,
  );

describe('ConnectTab (WI-5)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a loading skeleton while the overview loads', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderTab();
    expect(screen.getByTestId('connect-tab-loading')).toBeInTheDocument();
  });

  it('shows an error state when the overview fails', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: false, error: new Error('boom') });
    renderTab();
    expect(screen.getByTestId('connect-tab-error')).toBeInTheDocument();
  });

  it('renders the ConnectionPanel from overview.connectionInfo', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({ data: FIXTURE_ENDPOINT_OVERVIEW, isLoading: false, error: null });
    renderTab();
    expect(screen.getByTestId('connect-tab')).toBeInTheDocument();
    expect(screen.getByTestId('connect-tab-panel')).toBeInTheDocument();
    // The fixture enables oauth_client -> its radio + fields render.
    expect(screen.getByTestId('connect-tab-panel-method-oauth_client')).toBeInTheDocument();
    expect(screen.getByTestId('connect-tab-panel-value-clientIdentifier')).toBeInTheDocument();
  });

  it('lists the disabled methods with their enable hint', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({ data: FIXTURE_ENDPOINT_OVERVIEW, isLoading: false, error: null });
    renderTab();
    // The fixture disables wif.
    expect(screen.getByTestId('connect-tab-disabled')).toBeInTheDocument();
    expect(screen.getByTestId('connect-tab-disabled-wif')).toBeInTheDocument();
  });

  it('displays a retained secret when the reveal hook returns one (R3)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({ data: FIXTURE_ENDPOINT_OVERVIEW, isLoading: false, error: null });
    (useConnectionRetainedSecrets as ReturnType<typeof vi.fn>).mockReturnValue({ oauth_client: 'retained-secret-xyz' });
    renderTab();
    expect(screen.getByTestId('connect-tab-panel-value-clientSecret')).toHaveTextContent('retained-secret-xyz');
    expect(screen.getByTestId('connect-tab-panel-secret-retained-note')).toBeInTheDocument();
  });
});
