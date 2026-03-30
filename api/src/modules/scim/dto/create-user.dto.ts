import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  @IsArray()
  @ArrayNotEmpty()
  schemas!: string[];

  @IsString()
  @IsNotEmpty({ message: 'userName must not be empty or whitespace-only.' })
  userName!: string;

  @IsOptional()
  @IsString()
  externalId?: string;

  /**
   * Active status. Accepts boolean or string ("True"/"False") — coerced
   * to native boolean by sanitizeBooleanStringsByParent() in the service layer.
   *
   * Typed as `unknown` to prevent class-transformer's enableImplicitConversion
   * from calling Boolean("False") → true (any non-empty string is truthy in JS).
   * @see sanitizeBooleanStringsByParent
   */
  @IsOptional()
  active?: unknown;

  [key: string]: unknown;
}
