/**
 * EtagBadge.test.tsx - Phase K5 ETag badge primitive contract.
 *
 * @see docs/PHASE_K5_ETAG_AND_REQUIREIFMATCH.md
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EtagBadge } from './EtagBadge';

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('EtagBadge', () => {
  it('renders the version label for a known-version resource', () => {
    renderWithFluent(<EtagBadge resource={{ id: 'r1', meta: { version: 'W/"v7"' } }} />);
    const badge = screen.getByTestId('etag-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('v7');
  });

  it('renders the legacy display value for an ISO-style ETag', () => {
    renderWithFluent(<EtagBadge resource={{ id: 'r1', meta: { version: 'W/"2026-05-01T12:00:00Z"' } }} />);
    const badge = screen.getByTestId('etag-badge');
    expect(badge.textContent).toContain('2026-05-01');
  });

  it('renders nothing when meta.version is absent (drawer just shows no badge)', () => {
    renderWithFluent(<EtagBadge resource={{ id: 'r1' }} />);
    expect(screen.queryByTestId('etag-badge')).toBeNull();
  });

  it('exposes a tooltip / aria-label that includes "ETag" so screen readers can disambiguate', () => {
    renderWithFluent(<EtagBadge resource={{ id: 'r1', meta: { version: 'W/"v7"' } }} />);
    const badge = screen.getByTestId('etag-badge');
    // Either aria-label or title attribute carries the keyword.
    const tag = (badge.getAttribute('aria-label') ?? badge.getAttribute('title') ?? '').toLowerCase();
    expect(tag).toContain('etag');
  });
});
