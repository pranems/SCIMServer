/**
 * OverflowMenu.test.tsx (X1) - the uniform "More" overflow-menu control.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme, MenuItem } from '@fluentui/react-components';
import { OverflowMenu } from './OverflowMenu';

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('OverflowMenu', () => {
  it('renders a labelled "More" trigger (not a bare icon) with the forwarded testid', () => {
    renderWithFluent(
      <OverflowMenu ariaLabel="More actions for row 1" data-testid="x-more-1">
        <MenuItem data-testid="x-item-a">Reveal</MenuItem>
      </OverflowMenu>,
    );
    const trigger = screen.getByTestId('x-more-1');
    // The visible label makes it unmistakably clickable (X1).
    expect(trigger.textContent).toContain('More');
    expect(trigger.getAttribute('aria-label')).toBe('More actions for row 1');
  });

  it('supports a custom visible label', () => {
    renderWithFluent(
      <OverflowMenu ariaLabel="a11y" label="More options" data-testid="x-more-2">
        <MenuItem>X</MenuItem>
      </OverflowMenu>,
    );
    expect(screen.getByTestId('x-more-2').textContent).toContain('More options');
  });

  it('reveals its MenuItems only after the trigger is clicked', () => {
    renderWithFluent(
      <OverflowMenu ariaLabel="a11y" data-testid="x-more-3">
        <MenuItem data-testid="x-item-reveal">Reveal secret</MenuItem>
        <MenuItem data-testid="x-item-delete">Delete</MenuItem>
      </OverflowMenu>,
    );
    // Hidden until opened.
    expect(screen.queryByTestId('x-item-reveal')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('x-more-3'));
    expect(screen.getByTestId('x-item-reveal')).toBeInTheDocument();
    expect(screen.getByTestId('x-item-delete')).toBeInTheDocument();
  });
});
