/** Internal synchronous storage swap, prepared without changing live state. */
export interface EndpointDeletionStep {
  commit(): void;
  rollback(): void;
}

export function prepareMapRemoval<T>(
  current: Map<string, T>,
  remove: (row: T) => boolean,
  replace: (rows: Map<string, T>) => void,
): EndpointDeletionStep {
  const next = new Map([...current].filter(([, row]) => !remove(row)));
  return {
    commit: () => replace(next),
    rollback: () => replace(current),
  };
}
