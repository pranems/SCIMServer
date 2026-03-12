/**
 * Profile Preset Controller — Phase 13, Step 3.5
 *
 * Read-only API for listing and retrieving built-in profile presets.
 * No POST/PUT/DELETE — presets are code constants (decision D4).
 *
 * Routes:
 *   GET /admin/profile-presets           — List all 5 presets (name + description)
 *   GET /admin/profile-presets/:name     — Get full expanded profile for a preset
 *
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §6.1
 */
import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import {
  BUILT_IN_PRESETS,
  getAllPresetMetadata,
} from './built-in-presets';
import { validateAndExpandProfile } from './endpoint-profile.service';
import type { PresetMetadata } from './endpoint-profile.types';

@Controller('admin/profile-presets')
export class PresetController {
  /**
   * GET /admin/profile-presets
   * List all built-in presets with metadata (name, description, default flag).
   */
  @Get()
  listPresets(): PresetMetadata[] {
    return getAllPresetMetadata();
  }

  /**
   * GET /admin/profile-presets/:name
   * Get the full expanded EndpointProfile for a preset.
   * The profile is auto-expanded through the validation pipeline.
   */
  @Get(':name')
  getPreset(@Param('name') name: string) {
    const preset = BUILT_IN_PRESETS.get(name);
    if (!preset) {
      throw new NotFoundException(`Profile preset "${name}" not found. Valid presets: ${[...BUILT_IN_PRESETS.keys()].join(', ')}`);
    }

    // Expand the shorthand preset into a full profile
    const result = validateAndExpandProfile(preset.profile);
    if (!result.valid) {
      // This should never happen for built-in presets — indicates a bug
      throw new Error(`Built-in preset "${name}" failed validation: ${result.errors.map(e => e.detail).join('; ')}`);
    }

    return {
      ...preset.metadata,
      profile: result.profile,
    };
  }
}
