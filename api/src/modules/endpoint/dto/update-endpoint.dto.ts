export class UpdateEndpointDto {
  displayName?: string;
  description?: string;
  config?: Record<string, any>;
  active?: boolean;
}
