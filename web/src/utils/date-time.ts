export type DateTimeValue = string | number | Date | null | undefined;

export function formatDateTime(value: DateTimeValue): {
  text: string;
  iso?: string;
} {
  if (value === null || value === undefined || value === '') return { text: '-' };
  const invalid = { text: `Invalid timestamp: ${String(value)}` };
  if (typeof value === 'string' && !/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return invalid;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return invalid;
  const iso = date.toISOString();
  return { text: iso.replace('T', ' ').replace('Z', ' UTC'), iso };
}
