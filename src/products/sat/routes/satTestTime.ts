/** Parses an instant; null for absent or invalid values (never invents a date). */
function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export interface TestTimeParts {
  /** e.g. "Wed, 7 Oct 2026" */
  day: string;
  /** 24-hour clock, e.g. "09:03" */
  time: string;
}

/** Weekday, date and 24h time in the viewer's timezone; null when unknown. */
export function formatTestTime(value: string | null | undefined): TestTimeParts | null {
  const date = parseInstant(value);
  if (!date) return null;
  return {
    day: new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(date).replace(/^(\w{3}) /, '$1, '),
    time: new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date),
  };
}

/** Single-line form, e.g. "Wed, 7 Oct 2026 · 09:03"; "Unavailable" when unknown. */
export function formatTestTimeLine(value: string | null | undefined): string {
  const parts = formatTestTime(value);
  return parts ? `${parts.day} · ${parts.time}` : 'Unavailable';
}
/** Calendar-day key in the viewer timezone, used to detect multi-day access groups. */
export function testDayKey(value: string | null | undefined): string | null {
  const date = parseInstant(value);
  return date ? new Intl.DateTimeFormat('en-CA').format(date) : null;
}

/** e.g. "Asia/Bangkok (UTC+07:00)" */
export function viewerTimeZoneLabel(): string {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  const offset = new Intl.DateTimeFormat('en-US', { timeZoneName: 'longOffset' }).formatToParts(new Date()).find((part) => part.type === 'timeZoneName')?.value;
  const clean = offset && offset !== 'GMT' ? offset.replace('GMT', 'UTC') : 'UTC+00:00';
  return `${zone} (${clean})`;
}

/** Start of the viewer's calendar day for a yyyy-mm-dd input, as an RFC 3339 instant. */
export function localDayStartIso(day: string, addDays = 0): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + addDays);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
