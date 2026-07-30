/**
 * request-body-capture.ts - resolve what request body to persist on the
 * RequestLog, including the pre-parse failure edge cases.
 *
 * The happy path stores the parsed body the interceptor stashed on the meta.
 * But a request can fail BEFORE its body is parsed into `request.body`:
 *   - malformed JSON (correct content-type, body-parser throws 400) - the raw
 *     bytes were read by the parser's `verify` hook (see applyBodyParsers) and
 *     are available on `request.rawBody`, so we surface a capped preview;
 *   - wrong content-type (415) - the parser was SKIPPED (its type predicate did
 *     not match), so there are no raw bytes; we record a marker naming the
 *     content-type + length so the empty body is never ambiguous.
 *
 * In every case the returned value is a plain, JSON-serializable object so it
 * flows through the existing redaction + storage path unchanged. The
 * `_rawPreview` free-text (which can contain secrets from an unparseable blob)
 * is redacted by the caller (`LoggingService.recordRequest`) when the effective
 * `PersistRequestSecrets` flag is OFF.
 */
import type { Request } from 'express';
import type { RequestLoggingMeta } from './request-logging.interceptor';

/** Max bytes of any stored body (request or response) before truncation. */
export const MAX_STORED_BODY_BYTES = 32 * 1024;

/** An express request that may carry the raw body buffer stashed by the parser `verify` hook. */
export type RawBodyRequest = Request & { rawBody?: Buffer };

/** The marker stored in place of a body that could not be captured/parsed. */
export interface BodyNotCapturedMarker {
  _bodyNotCaptured: true;
  reason: 'content-type-rejected' | 'unparseable' | 'too-large' | 'client-aborted';
  contentType?: string;
  contentLength?: number;
  /** Best-effort capped raw text (unparseable case only); redacted by the caller when secrets are off. */
  _rawPreview?: string;
}

function isEmptyObject(v: unknown): boolean {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0;
}

function headerString(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/**
 * Decide what to persist as the RequestLog `requestBody`. Never throws.
 *
 * Precedence: an interceptor-stashed parsed body -> a non-empty `request.body`
 * -> a best-effort parse of the raw bytes (or an unparseable marker) -> a
 * content-type-rejected marker when bytes were sent but skipped -> the raw
 * (possibly empty) body for a genuine no-body request.
 */
export function resolveRequestBodyForLog(
  request: RawBodyRequest | undefined,
  meta: RequestLoggingMeta | undefined,
): unknown {
  try {
    const metaBody = meta?.requestBody;
    if (metaBody !== undefined && !isEmptyObject(metaBody)) return metaBody;

    const body = request?.body;
    if (body !== undefined && !isEmptyObject(body)) return body;

    const headers = request?.headers ?? {};
    const contentType = headerString(headers['content-type']);
    const rawHeaderLen = Number(headerString(headers['content-length']) ?? '0');
    const contentLength = Number.isFinite(rawHeaderLen) && rawHeaderLen > 0 ? rawHeaderLen : 0;

    const raw = request?.rawBody;
    if (raw && raw.length > 0) {
      const rawStr = raw.toString('utf8');
      try {
        return JSON.parse(rawStr);
      } catch {
        const marker: BodyNotCapturedMarker = {
          _bodyNotCaptured: true,
          reason: 'unparseable',
          contentType,
          contentLength: raw.length,
          _rawPreview: rawStr.length > MAX_STORED_BODY_BYTES ? rawStr.slice(0, MAX_STORED_BODY_BYTES) : rawStr,
        };
        return marker;
      }
    }

    if (contentLength > 0) {
      const marker: BodyNotCapturedMarker = {
        _bodyNotCaptured: true,
        reason: 'content-type-rejected',
        contentType,
        contentLength,
      };
      return marker;
    }

    // Genuine no-body request (GET, empty POST) - return whatever was there.
    return body;
  } catch {
    // Capture must never break request logging.
    return request?.body;
  }
}

/**
 * Cap a stringified body for storage. A body over the cap is replaced with a
 * truncation marker carrying the original length + a leading preview, so the
 * RequestLog table cannot be bloated by a multi-MB payload. Returns the input
 * unchanged when it is undefined or within the cap.
 */
export function capStoredBodyString(
  stringified: string | null | undefined,
  maxBytes: number = MAX_STORED_BODY_BYTES,
): string | null | undefined {
  if (stringified === undefined || stringified === null) return stringified;
  if (stringified.length <= maxBytes) return stringified;
  return JSON.stringify({
    _truncated: true,
    originalLength: stringified.length,
    preview: stringified.slice(0, maxBytes),
  });
}
