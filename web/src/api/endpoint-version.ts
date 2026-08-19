/**
 * Remembers the ETag each endpoint was last read at, so a write can say which
 * version it was based on.
 *
 * Kept out of the query cache deliberately: the value is a transport concern,
 * not part of the endpoint's response contract, and putting it in the cached
 * body would have meant changing a documented API shape to carry it.
 */
const versions = new Map<string, string>();

export function rememberEndpointVersion(id: string, etag: string | null | undefined): void {
  if (etag) versions.set(id, etag);
  else versions.delete(id);
}

export function getEndpointVersion(id: string): string | undefined {
  return versions.get(id);
}

export function forgetEndpointVersion(id: string): void {
  versions.delete(id);
}
