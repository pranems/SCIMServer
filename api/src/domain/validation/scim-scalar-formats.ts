/** RFC 7643 2.3.6: padding may be omitted; accept the standard and URL-safe alphabets. */
export function isScimBinary(value: string): boolean {
  if (!/^(?:[A-Za-z0-9+/]*|[A-Za-z0-9_-]*)={0,2}$/.test(value)) return false;
  const content = value.replace(/=+$/, '');
  const padding = value.length - content.length;
  const remainder = content.length % 4;
  return remainder !== 1 && (padding === 0 || (value.length % 4 === 0 && padding === (4 - remainder) % 4));
}

/** RFC 3986 URI-reference syntax, without network access or optional referential-integrity checks. */
export function isScimReference(value: string): boolean {
  if (!value || /[^A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/.test(value) || /%(?![0-9a-fA-F]{2})/.test(value)) return false;
  const parts = /^(?:([A-Za-z][A-Za-z0-9+.-]*):)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
  if (!parts) return false;
  const [, scheme, authority, path, query = '', fragment = ''] = parts;
  if (/[[\]]/.test(path + query + fragment)) return false;
  if (!scheme && authority === undefined && path.split('/')[0].includes(':')) return false;
  // WHATWG URL normalizes invalid whitespace/escapes; check the RFC character
  // grammar first, then use URL for authority (including IPv6/port) validation.
  try {
    new URL(value, 'https://scim.invalid/');
    return true;
  } catch { return false; }
}

/** xsd:dateTime with calendar, clock, and timezone bounds, not Date.parse normalization. */
export function isScimDateTime(value: string): boolean {
  const match = /^(-?)(\d{4,})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))?$/.exec(value);
  if (!match) return false;
  const [, , yearText, monthText, dayText, hourText, minuteText, secondText, fraction, zone, , zoneHourText, zoneMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!Number.isSafeInteger(year) || year === 0 || (yearText.length > 4 && yearText[0] === '0')) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return false;
  if (minute > 59 || second > 59 || hour > 24) return false;
  if (hour === 24 && (minute !== 0 || second !== 0 || (fraction && /[1-9]/.test(fraction)))) return false;
  if (zone && zone !== 'Z') {
    const zoneHour = Number(zoneHourText);
    const zoneMinute = Number(zoneMinuteText);
    if (zoneHour > 14 || zoneMinute > 59 || (zoneHour === 14 && zoneMinute !== 0)) return false;
  }
  return true;
}
