import type { ShorthandProfileInput } from '../../scim/endpoint-profile/endpoint-profile.types';

export class UpdateEndpointDto {
  displayName?: string;
  description?: string;
  active?: boolean;
  /** Partial profile update — settings deep-merged, schemas/RTs/SPC replaced. */
  profile?: Partial<ShorthandProfileInput>;
}
