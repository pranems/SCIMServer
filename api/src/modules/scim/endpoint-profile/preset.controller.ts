/**
 * Profile Preset Controller — Phase 13, Step 3.5 + JSON reload
 *
 * API for listing, retrieving, and reloading profile presets.
 * Presets are loaded from JSON files in `api/presets/` at startup.
 *
 * Routes:
 *   GET  /admin/profile-presets           — List all presets (name + description)
 *   GET  /admin/profile-presets/:name     — Get full expanded profile for a preset
 *   POST /admin/profile-presets/reload    — Reload all presets from JSON files on disk
 *
 * @see api/presets/*.json — source-of-truth preset definitions
 * @see docs/SCHEMA_TEMPLATES_DESIGN.md §6.1
 */
import { Controller, Get, Post, Param, NotFoundException } from '@nestjs/common';
import {
  BUILT_IN_PRESETS,
  getAllPresetMetadata,
  reloadPresetsFromDisk,
  getLastLoadResult,
} from './built-in-presets';
import { validateAndExpandProfile } from './endpoint-profile.service';
import type { PresetMetadata } from './endpoint-profile.types';

@Controller('admin/profile-presets')
export class PresetController {
  /**
   * GET /admin/profile-presets
   * List all presets with metadata (name, description, default flag).
   */
  @Get()
  listPresets(): PresetMetadata[] {
    return getAllPresetMetadata();
  }

  /**
   * POST /admin/profile-presets/reload
   * Re-read all preset JSON files from disk and refresh the in-memory registry.
   * Use this after editing JSON files to apply changes without restarting the server.
   *
   * Must be registered BEFORE the `:name` param route to avoid matching "reload" as a preset name.
   */
  @Post('reload')
  reloadPresets() {
    const result = reloadPresetsFromDisk();
    return {
      message: 'Presets reloaded from disk',
      dir: result.dir,
      loaded: result.loaded,
      fallback: result.fallback,
      custom: result.custom,
      totalPresets: result.loaded.length + result.fallback.length + result.custom.length,
    };
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
