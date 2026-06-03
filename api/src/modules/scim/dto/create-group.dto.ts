import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

export class GroupMemberDto {
  @IsString()
  @IsNotEmpty({ message: 'member value (id) must not be empty.' })
  value!: string;

  @IsOptional()
  @IsString()
  display?: string;

  @IsOptional()
  @IsString()
  type?: string;
}

export class CreateGroupDto {
  @IsArray()
  @ArrayNotEmpty()
  schemas!: string[];

  @IsString()
  @IsNotEmpty({ message: 'displayName must not be empty.' })
  displayName!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupMemberDto)
  members?: GroupMemberDto[];

  [key: string]: unknown;
}
