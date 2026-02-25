import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  ValidateNested
} from 'class-validator';
import { Type } from 'class-transformer';

export class PatchOperationDto {
  @IsString()
  @IsIn(['add', 'replace', 'remove', 'Add', 'Replace', 'Remove'], {
    message: 'op must be one of: add, replace, remove',
  })
  op!: string;

  @IsOptional()
  @IsString()
  path?: string;

  value?: unknown;
}

export class PatchUserDto {
  @IsArray()
  @ArrayNotEmpty()
  schemas!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000, { message: 'Operations array cannot exceed 1000 elements.' })
  @ValidateNested({ each: true })
  @Type(() => PatchOperationDto)
  Operations!: PatchOperationDto[];
}
