import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import type { Request } from 'express';

/** Cap the raw body we retain per request (matches the json() body limit). */
const RAW_BODY_LIMIT = '5mb';

/**
 * Apply the request body parsers, shared by production bootstrap (main.ts) and
 * the E2E harness (app.helper.ts) so both parse identically.
 *
 * Both parsers install a `verify` hook that stashes the RAW request buffer on
 * `req.rawBody` BEFORE parsing. This is what lets a request that fails at the
 * parse step (malformed JSON -> 400) still surface its bytes on the RequestLog:
 * the exception filter reads `req.rawBody` via `resolveRequestBodyForLog`. The
 * hook does NOT consume the stream (body-parser calls it as it reads), so it is
 * side-effect free for the happy path. A wrong-content-type request (415) never
 * reaches a parser (the `type` predicate is false), so `rawBody` stays unset and
 * the filter records a content-type-rejected marker instead.
 */
export function applyBodyParsers(app: NestExpressApplication): void {
  const stashRaw = (req: Request, _res: unknown, buf: Buffer): void => {
    // Retain the raw bytes for the log path only; capping happens at storage.
    (req as Request & { rawBody?: Buffer }).rawBody = buf;
  };

  // Accept both standard JSON and the SCIM media type.
  app.use(
    json({
      limit: RAW_BODY_LIMIT,
      verify: stashRaw,
      type: (req) => {
        const ct = req.headers['content-type']?.toLowerCase() ?? '';
        return ct.includes('application/json') || ct.includes('application/scim+json');
      },
    }),
  );

  // A3 - the OAuth token endpoints accept application/x-www-form-urlencoded
  // (RFC 6749 section 3.2).
  app.use(urlencoded({ extended: true, limit: '1mb', verify: stashRaw }));
}
