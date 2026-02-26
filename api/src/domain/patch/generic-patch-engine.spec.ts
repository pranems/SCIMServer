import { GenericPatchEngine } from './generic-patch-engine';
import { PatchError } from './patch-error';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makePayload(): Record<string, unknown> {
  return {
    displayName: 'Test Device',
    serialNumber: 'SN-001',
    active: true,
    name: { model: 'Widget', manufacturer: 'Acme' },
    tags: ['iot', 'production'],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GenericPatchEngine', () => {
  // ─── Basic construction ────────────────────────────────────────────

  it('should deep clone the input payload', () => {
    const original = makePayload();
    const engine = new GenericPatchEngine(original);
    engine.apply({ op: 'replace', path: 'displayName', value: 'Changed' });
    expect(original.displayName).toBe('Test Device'); // untouched
    expect(engine.getResult().displayName).toBe('Changed');
  });

  // ─── replace operations ───────────────────────────────────────────

  describe('replace', () => {
    it('should replace a top-level attribute', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'replace', path: 'displayName', value: 'New Name' });
      expect(engine.getResult().displayName).toBe('New Name');
    });

    it('should replace a nested attribute (dot notation)', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'replace', path: 'name.model', value: 'Gadget' });
      expect((engine.getResult().name as Record<string, unknown>).model).toBe('Gadget');
    });

    it('should replace an entire sub-object', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({
        op: 'replace',
        path: 'name',
        value: { model: 'NewModel', manufacturer: 'NewCorp' },
      });
      const name = engine.getResult().name as Record<string, unknown>;
      expect(name.model).toBe('NewModel');
      expect(name.manufacturer).toBe('NewCorp');
    });

    it('should replace an array attribute entirely', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'replace', path: 'tags', value: ['staging'] });
      expect(engine.getResult().tags).toEqual(['staging']);
    });

    it('should replace without path (merge into root)', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({
        op: 'replace',
        value: { displayName: 'Merged', newField: 'hello' },
      });
      const r = engine.getResult();
      expect(r.displayName).toBe('Merged');
      expect(r.newField).toBe('hello');
      expect(r.serialNumber).toBe('SN-001'); // preserved
    });

    it('should throw if replace without path has non-object value', () => {
      const engine = new GenericPatchEngine(makePayload());
      expect(() => engine.apply({ op: 'replace', value: 'string' })).toThrow(PatchError);
    });
  });

  // ─── add operations ───────────────────────────────────────────────

  describe('add', () => {
    it('should add a new top-level attribute', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'add', path: 'location', value: 'Building A' });
      expect(engine.getResult().location).toBe('Building A');
    });

    it('should add a nested attribute (creates intermediates)', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'add', path: 'specs.weight', value: 1.5 });
      const specs = engine.getResult().specs as Record<string, unknown>;
      expect(specs.weight).toBe(1.5);
    });

    it('should merge arrays when adding to an existing array', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'add', path: 'tags', value: ['staging', 'test'] });
      expect(engine.getResult().tags).toEqual(['iot', 'production', 'staging', 'test']);
    });

    it('should merge into root when no path is given', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'add', value: { firmware: 'v2.1' } });
      expect(engine.getResult().firmware).toBe('v2.1');
    });

    it('should throw if add without path has non-object value', () => {
      const engine = new GenericPatchEngine(makePayload());
      expect(() => engine.apply({ op: 'add', value: 42 })).toThrow(PatchError);
    });
  });

  // ─── remove operations ────────────────────────────────────────────

  describe('remove', () => {
    it('should remove a top-level attribute', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'remove', path: 'serialNumber' });
      expect(engine.getResult().serialNumber).toBeUndefined();
    });

    it('should remove a nested attribute (dot notation)', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'remove', path: 'name.manufacturer' });
      const name = engine.getResult().name as Record<string, unknown>;
      expect(name.manufacturer).toBeUndefined();
      expect(name.model).toBe('Widget'); // sibling preserved
    });

    it('should no-op when removing a non-existent path', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'remove', path: 'nonexistent.deep.path' });
      // Should not throw
      expect(engine.getResult().displayName).toBe('Test Device');
    });

    it('should throw when remove has no path', () => {
      const engine = new GenericPatchEngine(makePayload());
      expect(() => engine.apply({ op: 'remove' })).toThrow(PatchError);
    });
  });

  // ─── Extension URN paths ──────────────────────────────────────────

  describe('extension URN paths', () => {
    const urn = 'urn:example:ext:device:2.0';

    it('should set a field inside an extension URN', () => {
      const engine = new GenericPatchEngine({ displayName: 'Dev' });
      engine.apply({ op: 'add', path: `${urn}.firmware`, value: 'v1.0' });
      const ext = engine.getResult()[urn] as Record<string, unknown>;
      expect(ext.firmware).toBe('v1.0');
    });

    it('should replace a field inside an existing extension', () => {
      const engine = new GenericPatchEngine({
        displayName: 'Dev',
        [urn]: { firmware: 'v1.0', color: 'red' },
      });
      engine.apply({ op: 'replace', path: `${urn}.firmware`, value: 'v2.0' });
      const ext = engine.getResult()[urn] as Record<string, unknown>;
      expect(ext.firmware).toBe('v2.0');
      expect(ext.color).toBe('red');
    });

    it('should remove a field inside an extension URN', () => {
      const engine = new GenericPatchEngine({
        displayName: 'Dev',
        [urn]: { firmware: 'v1.0', color: 'red' },
      });
      engine.apply({ op: 'remove', path: `${urn}.color` });
      const ext = engine.getResult()[urn] as Record<string, unknown>;
      expect(ext.color).toBeUndefined();
      expect(ext.firmware).toBe('v1.0');
    });
  });

  // ─── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw PatchError for missing op field', () => {
      const engine = new GenericPatchEngine(makePayload());
      expect(() => engine.apply({} as any)).toThrow(PatchError);
    });

    it('should throw PatchError for unsupported op', () => {
      const engine = new GenericPatchEngine(makePayload());
      expect(() => engine.apply({ op: 'move', path: 'a' })).toThrow(PatchError);
    });

    it('should handle case-insensitive op names', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'Replace', path: 'displayName', value: 'CaseTest' });
      expect(engine.getResult().displayName).toBe('CaseTest');
    });
  });

  // ─── Multiple operations ──────────────────────────────────────────

  describe('multiple operations', () => {
    it('should apply a sequence of operations correctly', () => {
      const engine = new GenericPatchEngine(makePayload());
      engine.apply({ op: 'replace', path: 'displayName', value: 'Updated' });
      engine.apply({ op: 'add', path: 'location', value: 'Lab 3' });
      engine.apply({ op: 'remove', path: 'serialNumber' });
      engine.apply({ op: 'replace', path: 'active', value: false });

      const result = engine.getResult();
      expect(result.displayName).toBe('Updated');
      expect(result.location).toBe('Lab 3');
      expect(result.serialNumber).toBeUndefined();
      expect(result.active).toBe(false);
    });
  });
});
