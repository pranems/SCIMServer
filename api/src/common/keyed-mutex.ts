/**
 * Serializes async work per key within this process.
 *
 * Written for the admin authentication-method API, which loads the endpoint's
 * whole `authentication` block, edits it, and writes it back. Two concurrent
 * calls read the same block and the later write erases the earlier one, with
 * both callers receiving success - a silent lost update.
 *
 * Scope, deliberately: this is an in-process lock, so it is a complete fix only
 * while one process serves a given endpoint. Both dev and prod run
 * minReplicas = maxReplicas = 1 (dev-containerapp.yaml, prod-app-template.json),
 * so it closes the whole window today. Raising the replica count reopens it and
 * would need a conditional write in the database instead.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  /** Number of keys currently held or queued; exposed so leaks are testable. */
  get size(): number {
    return this.tails.size;
  }

  async runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    // A rejected predecessor must not poison the queue behind it.
    const tail = previous.then(() => held, () => held);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);

    try {
      return await fn();
    } finally {
      release();
      // Still the tail means nobody queued behind us, so the key can be dropped.
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
