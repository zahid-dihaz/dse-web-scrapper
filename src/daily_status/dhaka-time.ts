import { TIMEZONE } from './status.config';

// Native Intl only (no date library). All helpers take an explicit instant so
// they behave the same regardless of process.env.TZ.

interface DhakaParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(date: Date): DhakaParts {
  const map: Record<string, number> = {};
  for (const p of formatter.formatToParts(date)) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" for the Asia/Dhaka calendar date of the instant. */
export function dhakaDate(date: Date = new Date()): string {
  const p = parts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "HH:mm" in Asia/Dhaka, for notes. */
export function dhakaTime(date: Date = new Date()): string {
  const p = parts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Minutes since Dhaka midnight. */
export function dhakaMinutes(date: Date = new Date()): number {
  const p = parts(date);
  return p.hour * 60 + p.minute;
}

/** Day of week for a "YYYY-MM-DD" string (Sunday = 0). Calendar math only. */
export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "HH:mm" -> minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** The instant of a Dhaka wall-clock time on a "YYYY-MM-DD" date (UTC+6, no DST). */
export function dhakaInstant(dateStr: string, hhmm: string): Date {
  return new Date(`${dateStr}T${hhmm}:00+06:00`);
}
