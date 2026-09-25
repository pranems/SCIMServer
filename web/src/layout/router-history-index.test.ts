import { describe, expect, it } from 'vitest';
import { createMemoryHistory } from '@tanstack/react-router';
import { canGoForwardToIndex, getRouterHistoryIndex } from './router-history-index';

describe('router history index adapter', () => {
  it('tracks the installed TanStack memory-history index contract', () => {
    const history = createMemoryHistory({ initialEntries: ['/'] });
    expect(getRouterHistoryIndex(history.location.state)).toBe(0);

    history.push('/endpoints');
    expect(getRouterHistoryIndex(history.location.state)).toBe(1);

    history.back();
    expect(getRouterHistoryIndex(history.location.state)).toBe(0);
    expect(canGoForwardToIndex(0, 1)).toBe(true);
  });

  it('fails closed when a future history implementation omits or corrupts the index', () => {
    expect(getRouterHistoryIndex({ __TSR_index: Number.NaN })).toBe(0);
    expect(canGoForwardToIndex(1, 1)).toBe(false);
  });
});
