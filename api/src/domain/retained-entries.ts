const isEntry = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function identityField(entry: Record<string, unknown>, name: 'value' | 'type'): unknown {
  return Object.entries(entry).find(([key]) => key.toLowerCase() === name)?.[1];
}

const assignedType = (entry: Record<string, unknown>): unknown => identityField(entry, 'type') ?? undefined;

/** Reserve assigned type matches before occurrence fallback. Equal typed
 * duplicates keep occurrence order, including after protected type restoration.
 */
export function retainedEntries(before: readonly unknown[], after: readonly unknown[]): (Record<string, unknown> | undefined)[] {
  type Slot = { entry: Record<string, unknown>; used: boolean };
  type Bucket = { slots: Slot[]; types: Map<unknown, Slot[]>; cursor: number };
  const buckets = new Map<unknown, Bucket>();
  for (const entry of before.filter(isEntry)) {
    const value = identityField(entry, 'value');
    let bucket = buckets.get(value);
    if (!bucket) {
      bucket = { slots: [], types: new Map(), cursor: 0 };
      buckets.set(value, bucket);
    }
    const slot = { entry, used: false };
    bucket.slots.push(slot);
    const type = assignedType(entry);
    const typed = bucket.types.get(type) ?? [];
    typed.push(slot);
    bucket.types.set(type, typed);
  }
  for (const bucket of buckets.values()) {
    for (const typed of bucket.types.values()) typed.reverse();
  }
  const result: (Record<string, unknown> | undefined)[] = new Array(after.length).fill(undefined);
  after.forEach((entry, index) => {
    if (!isEntry(entry) || assignedType(entry) === undefined) return;
    const slot = buckets.get(identityField(entry, 'value'))?.types.get(assignedType(entry))?.pop();
    if (slot) {
      slot.used = true;
      result[index] = slot.entry;
    }
  });
  after.forEach((entry, index) => {
    if (!isEntry(entry) || result[index]) return;
    const bucket = buckets.get(identityField(entry, 'value'));
    if (!bucket) return;
    while (bucket.slots[bucket.cursor]?.used) bucket.cursor++;
    const slot = bucket.slots[bucket.cursor++];
    if (slot) {
      slot.used = true;
      result[index] = slot.entry;
    }
  });

  // Reservations select type capacity, not identity among indistinguishable occurrences.
  for (const bucket of buckets.values()) {
    bucket.types.clear();
    for (const slot of bucket.slots) {
      if (!slot.used) continue;
      const type = assignedType(slot.entry);
      const typed = bucket.types.get(type) ?? [];
      typed.push(slot);
      bucket.types.set(type, typed);
    }
    for (const typed of bucket.types.values()) typed.reverse();
  }
  return result.map(entry => entry === undefined ? undefined
    : buckets.get(identityField(entry, 'value'))?.types.get(assignedType(entry))?.pop()?.entry);
}
