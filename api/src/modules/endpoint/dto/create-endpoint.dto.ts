import type { ShorthandProfileInput } from '../../scim/endpoint-profile/endpoint-profile.types';

export class CreateEndpointDto {
  name!: string;
  displayName?: string;
  description?: string;
  /** Creation-time parameter: load a built-in preset (e.g., "entra-id"). Not persisted. */
  profilePreset?: string;
  /** Inline profile definition. Mutually exclusive with profilePreset. */
  profile?: ShorthandProfileInput;
}
