/**
 * interactive.ts (X1) - shared helpers that give NON-button clickable elements
 * (a `<tr>`, `<div>` row, a `<Card>`, a `<Badge>` chip) the SAME uniform
 * clickable affordance a real button has: a `button`/`switch` role, keyboard
 * activation (Enter + Space), and a focusable tab stop. Pair with a `cursor:
 * pointer` + `:hover` style class (the established row/card convention) so the
 * element reads as - and behaves as - an interactive control everywhere.
 *
 *   <tr {...clickableProps(() => openDetail(id), `Open ${name}`)} className={hoverRowClass}>
 *   <Badge {...toggleChipProps(() => setFilter(x), selected)} className={chipClass}>
 */
import type * as React from 'react';

/** Enter/Space keyboard activation for a non-button clickable element. */
export function onActivateKeyDown(onActivate: () => void) {
  return (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  };
}

export interface ClickableProps {
  role: 'button';
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  'aria-label'?: string;
}

/**
 * Props for a row/card/label that navigates or opens a detail on click. Gives
 * it `role="button"`, a keyboard handler, and a tab stop so a mouse click, an
 * Enter, and a Space all activate it identically.
 */
export function clickableProps(onActivate: () => void, ariaLabel?: string): ClickableProps {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: onActivateKeyDown(onActivate),
    ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
  };
}

export interface ToggleChipProps {
  role: 'button';
  tabIndex: 0;
  onClick: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  'aria-pressed': boolean;
  style: React.CSSProperties;
}

/**
 * Props for a filter/toggle chip (a clickable `<Badge>`): `role="button"` +
 * `aria-pressed` reflecting the selected state + keyboard activation + a
 * pointer cursor, so a chip is unmistakably interactive (not a static label).
 */
export function toggleChipProps(onToggle: () => void, selected: boolean): ToggleChipProps {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onToggle,
    onKeyDown: onActivateKeyDown(onToggle),
    'aria-pressed': selected,
    style: { cursor: 'pointer' },
  };
}
