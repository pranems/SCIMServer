import { ArrayMaxSize, ArrayNotEmpty, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

import { PatchOperationDto } from './patch-user.dto';

export class PatchGroupDto {
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
