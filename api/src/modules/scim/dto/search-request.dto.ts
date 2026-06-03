/**
 * SCIM Search Request DTO - RFC 7644 §3.4.3
 *
 * POST /.search is an alternative to GET for list/query operations
 * when the query is too complex for URL query parameters.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.3
 */
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SearchRequestDto {
  @IsOptional()
  schemas?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'attributes parameter is too long (max 2000 characters).' })
  attributes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'excludedAttributes parameter is too long (max 2000 characters).' })
  excludedAttributes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000, { message: 'filter is too long (max 10000 characters).' })
  filter?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200, { message: 'sortBy is too long (max 200 characters).' })
  sortBy?: string;

  @IsOptional()
  @IsIn(['ascending', 'descending'], { message: 'sortOrder must be ascending or descending.' })
  sortOrder?: 'ascending' | 'descending';

  @IsOptional()
  @IsInt({ message: 'startIndex must be an integer.' })
  @Min(1, { message: 'startIndex must be >= 1.' })
  startIndex?: number;

  @IsOptional()
  @IsInt({ message: 'count must be an integer.' })
  @Min(0, { message: 'count must be >= 0.' })
  @Max(10000, { message: 'count cannot exceed 10000.' })
  count?: number;
}
