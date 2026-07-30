/**
 * interactive.test.ts (X1) - the shared clickable-affordance helpers.
 */
import { describe, it, expect, vi } from 'vitest';
import type React from 'react';
import { clickableProps, toggleChipProps, onActivateKeyDown } from './interactive';

function keyEvent(key: string) {
  return { key, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;
}

describe('interactive helpers', () => {
  it('clickableProps exposes a button role, a tab stop, onClick, and a keyboard handler', () => {
    const activate = vi.fn();
    const props = clickableProps(activate, 'Open row 1');
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
    expect(props['aria-label']).toBe('Open row 1');
    props.onClick();
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('clickableProps activates on Enter and Space (and preventDefault) but not other keys', () => {
    const activate = vi.fn();
    const props = clickableProps(activate);
    const enter = keyEvent('Enter');
    props.onKeyDown(enter);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(enter.preventDefault).toHaveBeenCalled();

    props.onKeyDown(keyEvent(' '));
    expect(activate).toHaveBeenCalledTimes(2);

    props.onKeyDown(keyEvent('a'));
    expect(activate).toHaveBeenCalledTimes(2);
    // No aria-label when none supplied.
    expect(props['aria-label']).toBeUndefined();
  });

  it('toggleChipProps reflects the selected state via aria-pressed + a pointer cursor', () => {
    const toggle = vi.fn();
    const on = toggleChipProps(toggle, true);
    expect(on.role).toBe('button');
    expect(on['aria-pressed']).toBe(true);
    expect(on.style.cursor).toBe('pointer');
    on.onClick();
    expect(toggle).toHaveBeenCalledTimes(1);

    const off = toggleChipProps(toggle, false);
    expect(off['aria-pressed']).toBe(false);
  });

  it('onActivateKeyDown only fires on Enter/Space', () => {
    const fn = vi.fn();
    const handler = onActivateKeyDown(fn);
    handler(keyEvent('Enter'));
    handler(keyEvent(' '));
    handler(keyEvent('Escape'));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
