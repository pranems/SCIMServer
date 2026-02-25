import { ArrayNotEmpty, IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  [key: string]: unknown;
}
