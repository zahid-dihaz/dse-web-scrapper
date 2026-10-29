import {
  EndpointConfig,
  ENDPOINTS,
  ENDPOINT_STATUSES,
  getEndpointConfig,
} from './status.config';
import { dhakaTime } from './dhaka-time';

// Pure state transitions for a single endpoint entry. No I/O, so every rule
// can be unit tested without a database.

export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export interface EndpointEntry {
  endpoint: string;
  collection: string;
  source: EndpointConfig['source'];
  status: EndpointStatus;
  last_success_at: Date | null;
  rows: number;
  note: string | null;
}

export interface DailyStatusDoc {
  _id: string;
  exchange_open: boolean;
  overall_status: 'ok' | 'partial' | 'failed' | 'closed';
  generated_at: Date;
  updated_at: Date;
  endpoints: EndpointEntry[];
}

export const MAX_NOTE_LENGTH = 500;
/** Marks a note written by the watchdog; recordSuccess resolves it on its own. */
export const WATCHDOG_TEXT = 'collector not responding';
const RECOVERED_SUFFIX = ', recovered';

export function newEndpointEntries(): EndpointEntry[] {
  return ENDPOINTS.map((e) => ({
    endpoint: e.endpoint,
    collection: e.collection,
    source: e.source,
    status: 'failed',
    last_success_at: null,
    rows: 0,
    note: null,
  }));
}

export function truncateNote(note: string): string {
  return note.length > MAX_NOTE_LENGTH
    ? note.slice(0, MAX_NOTE_LENGTH - 1) + '…'
    : note;
}

/** "<label> at 12:14 (<detail>)" - Dhaka time. */
export function formatNote(
  label: string,
  detail: string | undefined,
  at: Date,
) {
  return `${label} at ${dhakaTime(at)}${detail ? ` (${detail})` : ''}`;
}

/**
 * Did this endpoint capture anything today? Rows > 0, or, for endpoints where
 * zero rows is legitimate (e.g. no circuit breaks), any recorded success.
 * Decides "failed" (nothing captured) versus "partial".
 */
function hasCaptured(entry: EndpointEntry): boolean {
  return (
    entry.rows > 0 ||
    (!!getEndpointConfig(entry.endpoint)?.zeroRowsAllowed &&
      entry.last_success_at !== null)
  );
}

const isRecovered = (note: string | null) =>
  !!note && note.endsWith(RECOVERED_SUFFIX);

export function applySuccess(
  entry: EndpointEntry,
  rows: number,
  now: Date,
  note?: string,
): EndpointEntry {
  // A failed endpoint that already has an outage note was down earlier today:
  // it recovers to "partial" so the missing window stays visible. A failed
  // endpoint with no note simply had not reported yet.
  const status: EndpointStatus =
    entry.status === 'partial' || (entry.status === 'failed' && entry.note)
      ? 'partial'
      : 'ok';
  // Keep an unresolved outage note; otherwise an informational note wins.
  const nextNote =
    note && !(status === 'partial' && entry.note) ? note : entry.note;
  const next: EndpointEntry = {
    ...entry,
    status,
    last_success_at: now,
    // Whole numbers only: the validator requires int/long for rows.
    rows: entry.rows + Math.max(0, Math.floor(rows)),
    note: nextNote === null ? null : truncateNote(nextNote),
  };
  // The watchdog flagged this endpoint as silent; a success proves it is
  // back, even if the collector never saw an error of its own.
  if (entry.note?.includes(WATCHDOG_TEXT) && !isRecovered(entry.note)) {
    return applyRecovery({ ...next, status: 'partial' }, now);
  }
  return next;
}

export function applyError(
  entry: EndpointEntry,
  errorType: string,
  detail: string | undefined,
  now: Date,
  opts: { since?: Date } = {},
): EndpointEntry {
  const text = opts.since
    ? `${errorType} since ${dhakaTime(opts.since)}`
    : formatNote(errorType, detail, now);
  const ongoing =
    entry.status !== 'ok' && !!entry.note && !isRecovered(entry.note);
  let note: string;
  if (ongoing) {
    note = entry.note as string; // keep the first note: it holds the outage start
  } else if (isRecovered(entry.note)) {
    note = `${entry.note}; ${text}`;
  } else {
    note = text;
  }
  return {
    ...entry,
    status: hasCaptured(entry) ? 'partial' : 'failed',
    note: truncateNote(note),
  };
}

/**
 * Watchdog: no capture for too long. Appends to (never replaces) a more
 * specific collector note; a no-op while its own note is still unresolved.
 */
export function applyStale(entry: EndpointEntry, since: Date): EndpointEntry {
  if (entry.note?.includes(WATCHDOG_TEXT) && !isRecovered(entry.note)) {
    return entry;
  }
  return appendIssue(
    entry,
    `no captures since ${dhakaTime(since)}, ${WATCHDOG_TEXT}`,
  );
}

/**
 * Flags an endpoint with a problem found by a checker (watchdog, finalizer):
 * appends `text` to any existing note and downgrades the status ("failed"
 * when nothing was captured today, see hasCaptured). No-op if already noted.
 */
export function appendIssue(entry: EndpointEntry, text: string): EndpointEntry {
  if (entry.note?.includes(text)) return entry;
  return {
    ...entry,
    status: hasCaptured(entry) ? 'partial' : 'failed',
    note: truncateNote(entry.note ? `${entry.note}; ${text}` : text),
  };
}

/** "connection lost at 12:14" + now 12:41 -> "connection lost 12:14–12:41, recovered" */
export function applyRecovery(entry: EndpointEntry, now: Date): EndpointEntry {
  if (entry.status !== 'partial' || isRecovered(entry.note)) return entry;
  const match = entry.note?.match(/^(.*?) (?:at|since) (\d{2}:\d{2})\b/);
  const note = match
    ? `${match[1]} ${match[2]}–${dhakaTime(now)}${RECOVERED_SUFFIX}`
    : `recovered at ${dhakaTime(now)}`;
  return { ...entry, note: truncateNote(note) };
}

export function computeOverall(
  endpoints: Pick<EndpointEntry, 'status'>[],
): 'ok' | 'partial' | 'failed' {
  if (endpoints.length && endpoints.every((e) => e.status === 'ok'))
    return 'ok';
  if (endpoints.length && endpoints.every((e) => e.status === 'failed'))
    return 'failed';
  return 'partial';
}
