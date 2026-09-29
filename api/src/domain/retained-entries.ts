const isEntry = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function identityField(entry: Record<string, unknown>, name: 'value' | 'type'): unknown {
  return Object.entries(entry).find(([key]) => key.toLowerCase() === name)?.[1];
}

/** Match each prior occurrence once. Type disambiguates repeated values;
 * entries without a value retain occurrence order rather than a fabricated ID.
 */
export function retainedEntries(before: readonly unknown[], after: readonly unknown[]): (Record<string, unknown> | undefined)[] {
  const buckets = new Map<unknown, Record<string, unknown>[]>();
  for (const entry of before.filter(isEntry)) {
    const value = identityField(entry, 'value');
    const bucket = buckets.get(value) ?? [];
    bucket.push(entry);
    buckets.set(value, bucket);
  }
  return after.map(entry => {
    if (!isEntry(entry)) return undefined;
    const bucket = buckets.get(identityField(entry, 'value'));
    if (!bucket?.length) return undefined;
    const type = identityField(entry, 'type');
    const index = type === undefined ? 0 : bucket.findIndex(old => identityField(old, 'type') === type);
    return bucket.splice(index < 0 ? 0 : index, 1)[0];
  });
}
