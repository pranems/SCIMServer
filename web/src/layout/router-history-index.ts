interface RouterHistoryState {
  __TSR_index?: unknown;
}

/**
 * TanStack exposes Back availability but not Forward availability. Its history
 * state carries the in-app index used by `canGoBack()`. Keep the private-field
 * dependency in this adapter so a router upgrade has one contract boundary.
 */
export function getRouterHistoryIndex(state: RouterHistoryState): number {
  const index = state.__TSR_index;
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : 0;
}

export function canGoForwardToIndex(currentIndex: number, highestReachableIndex: number): boolean {
  return currentIndex < highestReachableIndex;
}
