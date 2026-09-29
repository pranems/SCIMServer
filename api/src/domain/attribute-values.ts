type Entry = Record<string, unknown>;
const objectValue = (value: unknown): value is Entry =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const read = (entry: Entry, name: string): unknown => {
  const key = Object.keys(entry).find(key => key.toLowerCase() === name);
  return key === undefined ? undefined : entry[key];
};
const typeOf = (entry: Entry): unknown => read(entry, 'type') ?? undefined;

/**
 * Pair each retained complex value at most once. Reserve exact type matches
 * before occurrence fallback so an omitted/changed type cannot steal one.
 * Equal value/type duplicates use candidate occurrence order even when a type
 * was omitted; restoring that type must not change the next pairing.
 * Null and absent types are both unassigned, so restoring null cannot acquire
 * exact-type priority. This does not alter their payload representations.
 * Anonymous entries have occurrence order,
 * not a fabricated identity. Missing value and explicit null remain distinct.
 */
export function retainedEntries(before: readonly unknown[], after: readonly unknown[]): (Entry | undefined)[] {
  type Slot = { entry: Entry; used: boolean };
  type Bucket = { slots: Slot[]; types: Map<unknown, Slot[]>; cursor: number };
  const buckets = new Map<unknown, Bucket>();
  for (const entry of before) {
    if (!objectValue(entry)) continue;
    const value = read(entry, 'value');
    let bucket = buckets.get(value);
    if (!bucket) {
      bucket = { slots: [], types: new Map(), cursor: 0 };
      buckets.set(value, bucket);
    }
    const slot = { entry, used: false };
    bucket.slots.push(slot);
    const type = typeOf(entry);
    const typed = bucket.types.get(type) ?? [];
    typed.push(slot);
    bucket.types.set(type, typed);
  }
  // Reverse once so pop consumes typed occurrences in original order in O(1).
  for (const bucket of buckets.values()) for (const typed of bucket.types.values()) typed.reverse();
  const result: (Entry | undefined)[] = new Array(after.length).fill(undefined);
  after.forEach((entry, index) => {
    if (!objectValue(entry) || typeOf(entry) === undefined) return;
    const slot = buckets.get(read(entry, 'value'))?.types.get(typeOf(entry))?.pop();
    if (slot) { slot.used = true; result[index] = slot.entry; }
  });
  after.forEach((entry, index) => {
    if (!objectValue(entry) || result[index]) return;
    const bucket = buckets.get(read(entry, 'value'));
    if (!bucket) return;
    while (bucket.slots[bucket.cursor]?.used) bucket.cursor++;
    const slot = bucket.slots[bucket.cursor++];
    if (slot) { slot.used = true; result[index] = slot.entry; }
  });
  // Reservations choose type capacity, not identity among equal typed entries.
  // Redistribute the selected occurrences in stored order within each type.
  for (const bucket of buckets.values()) {
    bucket.types.clear();
    for (const slot of bucket.slots) {
      if (!slot.used) continue;
      const type = typeOf(slot.entry);
      const typed = bucket.types.get(type) ?? [];
      typed.push(slot);
      bucket.types.set(type, typed);
    }
    for (const typed of bucket.types.values()) typed.reverse();
  }
  return result.map(entry => entry === undefined ? undefined
    : buckets.get(read(entry, 'value'))?.types.get(typeOf(entry))?.pop()?.entry);
}
