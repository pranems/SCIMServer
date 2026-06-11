/**
 * EmptyState primitive tests.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EmptyState } from './EmptyState';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('EmptyState', () => {
  it('renders the title and the test wrapper', () => {
    wrap(<EmptyState title="No credentials yet" />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state-title')).toHaveTextContent('No credentials yet');
  });

  it('renders the body when provided', () => {
    wrap(<EmptyState title="X" body="Click below to mint one." />);
    expect(screen.getByTestId('empty-state-body')).toHaveTextContent('Click below to mint one.');
  });

  it('renders an icon when provided', () => {
    wrap(<EmptyState title="X" icon={<span>📭</span>} />);
    expect(screen.getByTestId('empty-state-icon')).toBeInTheDocument();
  });

  it('shows the action button only when both label and handler are set', () => {
    const onAction = vi.fn();
    wrap(<EmptyState title="X" actionLabel="Mint credential" onAction={onAction} />);
    const btn = screen.getByTestId('empty-state-action');
    expect(btn).toHaveTextContent('Mint credential');
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('omits the action button when label is set without a handler', () => {
    wrap(<EmptyState title="X" actionLabel="Mint" />);
    expect(screen.queryByTestId('empty-state-action')).not.toBeInTheDocument();
  });

  it('honors a custom data-testid', () => {
    wrap(<EmptyState data-testid="creds-empty" title="X" />);
    expect(screen.getByTestId('creds-empty')).toBeInTheDocument();
    expect(screen.getByTestId('creds-empty-title')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });

  it('uses role="status" with aria-live="polite" for screen reader announce', () => {
    wrap(<EmptyState title="No data" />);
    const node = screen.getByTestId('empty-state');
    expect(node).toHaveAttribute('role', 'status');
    expect(node).toHaveAttribute('aria-live', 'polite');
  });
});
