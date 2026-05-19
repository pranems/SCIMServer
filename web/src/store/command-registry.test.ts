/**
 * command-registry.test.ts - Phase N6 (Keyboard ergonomics).
 *
 * Verifies the global command registry that the Cmd/Ctrl+K palette
 * (and any future hotkey driver) walks to render its list and to
 * execute a chosen command.
 *
 * Contract:
 *  - register(command) appends; duplicate id throws.
 *  - unregister(id) removes; missing id is a no-op.
 *  - all() returns a frozen snapshot in insertion order.
 *  - filter(query) is a substring + token match against `label` and
 *    `keywords`; empty/whitespace query returns all().
 *  - run(id) invokes the registered handler exactly once.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commandRegistry, type Command } from './command-registry';

describe('command-registry', () => {
  beforeEach(() => {
    commandRegistry.clear();
  });

  describe('register / unregister / all', () => {
    it('register appends a command and all() returns it', () => {
      const handler = vi.fn();
      commandRegistry.register({ id: 'goto.dashboard', label: 'Go to Dashboard', run: handler });
      const list = commandRegistry.all();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe('goto.dashboard');
    });

    it('register throws on duplicate id', () => {
      commandRegistry.register({ id: 'x', label: 'X', run: () => {} });
      expect(() => commandRegistry.register({ id: 'x', label: 'X2', run: () => {} })).toThrow(/duplicate/i);
    });

    it('unregister removes by id; missing id is a no-op', () => {
      commandRegistry.register({ id: 'a', label: 'A', run: () => {} });
      commandRegistry.register({ id: 'b', label: 'B', run: () => {} });
      commandRegistry.unregister('a');
      expect(commandRegistry.all().map((c) => c.id)).toEqual(['b']);
      // Missing id - no throw.
      commandRegistry.unregister('does-not-exist');
      expect(commandRegistry.all()).toHaveLength(1);
    });

    it('all() preserves insertion order', () => {
      commandRegistry.register({ id: 'one', label: 'One', run: () => {} });
      commandRegistry.register({ id: 'two', label: 'Two', run: () => {} });
      commandRegistry.register({ id: 'three', label: 'Three', run: () => {} });
      expect(commandRegistry.all().map((c) => c.id)).toEqual(['one', 'two', 'three']);
    });
  });

  describe('filter()', () => {
    beforeEach(() => {
      commandRegistry.register({ id: 'goto.dashboard', label: 'Go to Dashboard', run: () => {}, keywords: ['home'] });
      commandRegistry.register({ id: 'goto.endpoints', label: 'Go to Endpoints', run: () => {} });
      commandRegistry.register({ id: 'theme.toggle', label: 'Toggle theme', run: () => {}, keywords: ['dark', 'light'] });
    });

    it('empty query returns all() unchanged', () => {
      expect(commandRegistry.filter('').map((c) => c.id)).toEqual(['goto.dashboard', 'goto.endpoints', 'theme.toggle']);
      expect(commandRegistry.filter('   ').map((c) => c.id)).toEqual(['goto.dashboard', 'goto.endpoints', 'theme.toggle']);
    });

    it('substring match on label is case-insensitive', () => {
      expect(commandRegistry.filter('dash').map((c) => c.id)).toEqual(['goto.dashboard']);
      expect(commandRegistry.filter('DASH').map((c) => c.id)).toEqual(['goto.dashboard']);
    });

    it('substring match on keywords picks up the keyword-only hit', () => {
      // "home" is only a keyword of goto.dashboard (not in label).
      const hit = commandRegistry.filter('home');
      expect(hit.map((c) => c.id)).toEqual(['goto.dashboard']);
    });

    it('multi-token query requires ALL tokens to hit (AND semantics)', () => {
      // "go end" -> matches "Go to Endpoints" but not "Go to Dashboard".
      expect(commandRegistry.filter('go end').map((c) => c.id)).toEqual(['goto.endpoints']);
    });

    it('no matches returns empty array', () => {
      expect(commandRegistry.filter('xyzzy')).toEqual([]);
    });
  });

  describe('run()', () => {
    it('invokes the handler exactly once', () => {
      const handler = vi.fn();
      commandRegistry.register({ id: 'go', label: 'Go', run: handler });
      commandRegistry.run('go');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws when the id is not registered', () => {
      expect(() => commandRegistry.run('missing')).toThrow(/not registered/i);
    });
  });
});

// Test imports are typed via the Command interface; verify it's exported.
const _typeProbe: Command = { id: 't', label: 'T', run: () => {} };
void _typeProbe;
