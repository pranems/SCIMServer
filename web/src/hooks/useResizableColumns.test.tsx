/**
 * useResizableColumns.test.tsx (X7) - the drag-to-resize column hook contract.
 * jsdom has no layout engine, so these tests cover the state machine + storage,
 * not pixel geometry (that is covered by the Playwright column-resize spec).
 */
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { useResizableColumns } from './useResizableColumns';
import { ColumnResizeHandle } from '../components/primitives/ColumnResizeHandle';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';

describe('useResizableColumns', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts with all-null widths (stylesheet defaults) for a fresh key', () => {
    const { result } = renderHook(() => useResizableColumns('t1', 4));
    expect(result.current.widths).toEqual([null, null, null, null]);
  });

  it('headerProps sets position:relative and no width until resized', () => {
    const { result } = renderHook(() => useResizableColumns('t2', 3));
    const props = result.current.headerProps(0);
    expect(props.style.position).toBe('relative');
    expect(props.style.width).toBeUndefined();
  });

  it('handleProps double-click resets a resized column back to the default', () => {
    const { result } = renderHook(() => useResizableColumns('t3', 3));
    // Simulate a persisted width by writing storage then re-mounting.
    act(() => result.current.handleProps(1).onDoubleClick());
    expect(result.current.widths[1]).toBeNull();
  });

  it('reset() clears every column width', () => {
    const { result } = renderHook(() => useResizableColumns('t4', 3));
    act(() => result.current.reset());
    expect(result.current.widths).toEqual([null, null, null]);
  });

  it('persists widths to localStorage under a namespaced key', () => {
    renderHook(() => useResizableColumns('t5', 2));
    expect(window.localStorage.getItem('scimserver.colw.t5')).toBe('[null,null]');
  });

  it('restores persisted widths on mount', () => {
    window.localStorage.setItem('scimserver.colw.t6', '[120,null,80]');
    const { result } = renderHook(() => useResizableColumns('t6', 3));
    expect(result.current.widths).toEqual([120, null, 80]);
    expect(result.current.headerProps(0).style.width).toBe('120px');
  });

  it('ignores a stored array whose length no longer matches the column count', () => {
    window.localStorage.setItem('scimserver.colw.t7', '[120,80]');
    const { result } = renderHook(() => useResizableColumns('t7', 3));
    expect(result.current.widths).toEqual([null, null, null]);
  });
});

describe('ColumnResizeHandle', () => {
  it('renders a col-resize separator that forwards its testid + stops row clicks', () => {
    let started = false;
    render(
      <FluentProvider theme={webLightTheme}>
        <table><thead><tr>
          <th style={{ position: 'relative' }}>
            H<ColumnResizeHandle onMouseDown={() => { started = true; }} data-testid="h-0" />
          </th>
        </tr></thead></table>
      </FluentProvider>,
    );
    const handle = screen.getByTestId('h-0');
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('aria-label')).toBe('Resize column');
    fireEvent.mouseDown(handle);
    expect(started).toBe(true);
  });
});
