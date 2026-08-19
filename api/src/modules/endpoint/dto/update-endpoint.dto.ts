import type { ShorthandProfileInput } from '../../scim/endpoint-profile/endpoint-profile.types';

export class UpdateEndpointDto {
  displayName?: string;
  description?: string;
  active?: boolean;
  /** Partial profile update - settings + SPC per-key merged, schemas/RTs/auth replaced. */
  profile?: Partial<ShorthandProfileInput>;
}
