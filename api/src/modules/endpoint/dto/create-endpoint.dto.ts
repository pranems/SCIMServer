export class CreateEndpointDto {
  name!: string;
  displayName?: string;
  description?: string;
  config?: Record<string, any>;
}
