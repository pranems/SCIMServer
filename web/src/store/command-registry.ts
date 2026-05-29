/**
 * Phase N6 - command-registry.
 *
 * Process-wide registry of palette commands. A command is anything
 * the operator can invoke from the Cmd/Ctrl+K palette:
 *   - Route navigations ("Go to Dashboard").
 *   - Chrome toggles ("Toggle theme", "Toggle sidebar").
 *   - Cross-cutting flows ("Reset onboarding").
 *
 * Why a module-level singleton (not a React context):
 *  - Commands are registered at boot from main.tsx + opportunistically
 *    from feature modules; they outlive any single React tree.
 *  - Hotkey drivers (Phase N6 commit 2/3) live outside React.
 *  - Test isolation is via the explicit `clear()` method.
 *
 * @see web/src/store/command-registry.test.ts
 * @see web/src/components/primitives/CommandPalette.tsx
 */

export interface Command {
  /** Stable unique identifier; convention: `<scope>.<verb>`. */
  id: string;
  /** Operator-facing label rendered in the palette list. */
  label: string;
  /** Optional secondary terms boosted by `filter()` substring match. */
  keywords?: string[];
  /** Imperative action; called from `commandRegistry.run(id)`. */
  run: () => void | Promise<void>;
}

class CommandRegistry {
  private commands: Command[] = [];

  register(cmd: Command): void {
    if (this.commands.some((c) => c.id === cmd.id)) {
      throw new Error(`command-registry: duplicate id ${cmd.id}`);
    }
    this.commands.push(cmd);
  }

  unregister(id: string): void {
    const idx = this.commands.findIndex((c) => c.id === id);
    if (idx >= 0) this.commands.splice(idx, 1);
  }

  clear(): void {
    this.commands = [];
  }

  all(): readonly Command[] {
    return [...this.commands];
  }

  /**
   * Filter by a free-text query. AND semantics across whitespace-
   * separated tokens, substring match on `label` or any `keywords[]`
   * entry. Empty / whitespace-only query returns the full list.
   */
  filter(query: string): Command[] {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return this.all() as Command[];
    const tokens = q.split(/\s+/);
    return this.commands.filter((c) => {
      const haystack = [c.label, ...(c.keywords ?? [])].join(' ').toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }

  run(id: string): void | Promise<void> {
    const cmd = this.commands.find((c) => c.id === id);
    if (!cmd) throw new Error(`command-registry: id "${id}" not registered`);
    return cmd.run();
  }
}

export const commandRegistry = new CommandRegistry();
