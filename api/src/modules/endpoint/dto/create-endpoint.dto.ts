import type { ShorthandProfileInput } from '../../scim/endpoint-profile/endpoint-profile.types';

export class CreateEndpointDto {
  name!: string;
  displayName?: string;
  description?: string;
  /** @deprecated Use profilePreset or profile instead. Kept for backward compatibility. */
  config?: Record<string, any>;
  /** Creation-time parameter: load a built-in preset (e.g., "entra-id"). Not persisted. */
  profilePreset?: string;
  /** Inline profile definition. Mutually exclusive with profilePreset. */
  profile?: ShorthandProfileInput;
}
