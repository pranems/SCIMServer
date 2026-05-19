/**
 * LoadingSkeleton primitive tests.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { LoadingSkeleton } from './LoadingSkeleton';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('LoadingSkeleton', () => {
  it('renders one item by default', () => {
    wrap(<LoadingSkeleton />);
    expect(screen.getByTestId('loading-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('loading-skeleton-item')).toHaveLength(1);
  });

  it('renders the requested number of items', () => {
    wrap(<LoadingSkeleton count={5} />);
    expect(screen.getAllByTestId('loading-skeleton-item')).toHaveLength(5);
  });

  it('clamps count to at least 1 (defensive against bad inputs)', () => {
    wrap(<LoadingSkeleton count={0} />);
    expect(screen.getAllByTestId('loading-skeleton-item')).toHaveLength(1);
  });

  it('clamps count to a maximum of 100 (defensive against runaway values)', () => {
    wrap(<LoadingSkeleton count={9999} />);
    expect(screen.getAllByTestId('loading-skeleton-item')).toHaveLength(100);
  });

  it('exposes the configured aria-label for assistive tech', () => {
    wrap(<LoadingSkeleton ariaLabel="Loading credentials..." />);
    expect(screen.getByTestId('loading-skeleton')).toHaveAttribute(
      'aria-label',
      'Loading credentials...',
    );
  });

  it('honors a custom data-testid', () => {
    wrap(<LoadingSkeleton data-testid="users-skeleton" count={2} />);
    expect(screen.getByTestId('users-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('users-skeleton-item')).toHaveLength(2);
  });
});
