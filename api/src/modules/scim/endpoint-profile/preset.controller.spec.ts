/**
 * Unit Tests — Preset Controller (Phase 13, Step 3.5)
 *
 * Tests the read-only preset API: list all presets, get by name, 404 for unknown.
 */
import { NotFoundException } from '@nestjs/common';
import { PresetController } from './preset.controller';
import { PRESET_NAMES, BUILT_IN_PRESETS } from './built-in-presets';

describe('PresetController', () => {
  let controller: PresetController;

  beforeEach(() => {
    controller = new PresetController();
  });

  describe('GET /admin/profile-presets (listPresets)', () => {
    it('should return 5 presets', () => {
      const result = controller.listPresets();
      expect(result).toHaveLength(5);
    });

    it('should return metadata with name and description', () => {
      const result = controller.listPresets();
      for (const preset of result) {
        expect(preset.name).toBeDefined();
        expect(typeof preset.name).toBe('string');
        expect(preset.description).toBeDefined();
        expect(typeof preset.description).toBe('string');
      }
    });

    it('should mark entra-id as default', () => {
      const result = controller.listPresets();
      const entraId = result.find(p => p.name === 'entra-id');
      expect(entraId!.default).toBe(true);
    });

    it('should list in correct order', () => {
      const result = controller.listPresets();
      expect(result[0].name).toBe('entra-id');
      expect(result[1].name).toBe('entra-id-minimal');
      expect(result[2].name).toBe('rfc-standard');
      expect(result[3].name).toBe('minimal');
      expect(result[4].name).toBe('user-only');
    });
  });

  describe('GET /admin/profile-presets/:name (getPreset)', () => {
    for (const presetName of PRESET_NAMES) {
      it(`should return expanded profile for "${presetName}"`, () => {
        const result = controller.getPreset(presetName);
        expect(result).toBeDefined();
        expect(result.name).toBe(presetName);
        expect(result.profile).toBeDefined();
        expect(result.profile!.schemas.length).toBeGreaterThan(0);
        expect(result.profile!.resourceTypes.length).toBeGreaterThan(0);
        expect(result.profile!.serviceProviderConfig).toBeDefined();
        expect(result.profile!.settings).toBeDefined();
      });
    }

    it('should return fully expanded attributes (not "all" shorthand)', () => {
      const result = controller.getPreset('rfc-standard');
      const userSchema = result.profile!.schemas.find((s: any) => s.name === 'User');
      expect(Array.isArray(userSchema!.attributes)).toBe(true);
      expect(userSchema!.attributes.length).toBeGreaterThan(10);
      // Verify attributes have full characteristics
      const userName = userSchema!.attributes.find((a: any) => a.name === 'userName');
      expect(userName!.type).toBe('string');
      expect(userName!.required).toBe(true);
    });

    it('should throw NotFoundException for unknown preset', () => {
      expect(() => controller.getPreset('nonexistent')).toThrow(NotFoundException);
    });

    it('should include valid presets in 404 error message', () => {
      try {
        controller.getPreset('bad-name');
        fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('entra-id');
        expect(e.message).toContain('rfc-standard');
      }
    });

    it('should return metadata fields alongside profile', () => {
      const result = controller.getPreset('entra-id');
      expect(result.name).toBe('entra-id');
      expect(result.description).toBeDefined();
      expect(result.default).toBe(true);
    });
  });
});
