/**
 * SCIM Search Request DTO — RFC 7644 §3.4.3
 *
 * POST /.search is an alternative to GET for list/query operations
 * when the query is too complex for URL query parameters.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7644#section-3.4.3
 */
export class SearchRequestDto {
  schemas?: string[];
  attributes?: string;
  excludedAttributes?: string;
  filter?: string;
  sortBy?: string;
  sortOrder?: 'ascending' | 'descending';
  startIndex?: number;
  count?: number;
}
