/**
 * AuthMethodChip.test.tsx - X5 auth-method chip contract shared by every
 * log/activity row surface.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { AuthMethodChip, methodLabel, isTokenMintUrl } from './AuthMethodChip';

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('AuthMethodChip', () => {
  it('renders "auth ok - <method>" for an accepted resource request', () => {
    renderWithFluent(
      <AuthMethodChip outcome="accept" method="bearer_jwt" url="/scim/v2/endpoints/e1/Users" data-testid="chip" />,
    );
    const chip = screen.getByTestId('chip');
    expect(chip.textContent).toContain('auth ok');
    expect(chip.textContent).toContain('OAuth JWT');
  });

  it('renders "JWT - <method>" for an accepted token-mint request', () => {
    renderWithFluent(
      <AuthMethodChip outcome="accept" method="oauth_client" url="/scim/endpoints/e1/oauth/token" data-testid="chip" />,
    );
    const chip = screen.getByTestId('chip');
    expect(chip.textContent).toContain('JWT');
    expect(chip.textContent).toContain('OAuth client');
    // The title explains the minted token type.
    expect((chip.getAttribute('title') ?? '').toLowerCase()).toContain('jwt bearer token');
  });

  it('renders the reason code for a rejected request', () => {
    renderWithFluent(
      <AuthMethodChip outcome="reject" method="bearer_jwt" reason="bearer_expired" url="/scim/v2/endpoints/e1/Users" data-testid="chip" />,
    );
    expect(screen.getByTestId('chip').textContent).toContain('bearer_expired');
  });

  it('renders a muted "-" when there is no auth decision', () => {
    renderWithFluent(<AuthMethodChip data-testid="chip" />);
    expect(screen.getByTestId('chip').textContent).toBe('-');
  });

  it('maps internal method keywords to friendly labels', () => {
    expect(methodLabel('wif')).toBe('WIF');
    expect(methodLabel('shared_secret')).toBe('Global secret');
    expect(methodLabel('endpoint_bearer')).toBe('Endpoint bearer');
    expect(methodLabel(undefined)).toBe('unknown');
    // An unknown keyword passes through unchanged.
    expect(methodLabel('something_new')).toBe('something_new');
  });

  it('detects a token-mint URL', () => {
    expect(isTokenMintUrl('/scim/endpoints/e1/oauth/token')).toBe(true);
    expect(isTokenMintUrl('/scim/oauth/token')).toBe(true);
    expect(isTokenMintUrl('/scim/v2/endpoints/e1/Users')).toBe(false);
    expect(isTokenMintUrl(undefined)).toBe(false);
  });
});
