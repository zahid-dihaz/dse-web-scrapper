// Single source of truth for the daily_status heartbeat system. The status
// service, bootstrap validator, watchdog and finalizer all read from here.
import 'dotenv/config';

export const STATUS_COLLECTION = 'daily_status';
export const SESSION_COLLECTION = 'market_sessions';
export const TIMEZONE = 'Asia/Dhaka';

const DEFAULT_COMPANIES_SCRAPE_TIME = '10:20';
const COMPANIES_DEADLINE_MARGIN_MIN = 40;

/**
 * Dhaka HH:mm the once-a-day /companies scrape runs at, from
 * COMPANIES_SCRAPE_TIME. The scraper's cron and the watchdog deadline are both
 * derived from it, so they cannot drift apart. An unset or malformed value
 * falls back to the default.
 */
export function companiesScrapeTime(
  raw: string | undefined = process.env.COMPANIES_SCRAPE_TIME,
): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec((raw ?? '').trim());
  if (!m) {
    if (raw) {
      console.warn(
        `[status.config] invalid COMPANIES_SCRAPE_TIME "${raw}", using ${DEFAULT_COMPANIES_SCRAPE_TIME}`,
      );
    }
    return DEFAULT_COMPANIES_SCRAPE_TIME;
  }
  return `${m[1]}:${m[2]}`;
}

/** Cron expression (Sun-Thu) for the /companies scrape. */
export function companiesCron(time: string = companiesScrapeTime()): string {
  const [h, m] = time.split(':').map(Number);
  return `${m} ${h} * * 0-4`;
}

/** Scrape time plus a margin; a missing capture after this is stale. */
export function companiesDeadline(
  time: string = companiesScrapeTime(),
): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(
    h * 60 + m + COMPANIES_DEADLINE_MARGIN_MIN,
    23 * 60 + 59,
  );
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

export type EndpointSource = 'puppeteer' | 'mysql';

export interface EndpointConfig {
  /** API path served by the provider. */
  endpoint: string;
  /** MongoDB collection the collector writes to (names used by the code today). */
  collection: string;
  source: EndpointSource;
  /** How often the collector is expected to succeed, in minutes. */
  expectedIntervalMin: number;
  /** Watchdog marks the endpoint stale when last_success_at is older than this. */
  watchdogThresholdMin: number;
  /**
   * For once-a-day collectors: Dhaka HH:mm after which a missing capture
   * counts as stale (the interval/threshold pair is meaningless for them).
   */
  dailyDeadline?: string;
  /** Zero rows is a legitimate result (e.g. no circuit breaks that day). */
  zeroRowsAllowed: boolean;
}

export const ENDPOINTS: readonly EndpointConfig[] = [
  {
    endpoint: '/companies',
    collection: 'companies_dses',
    source: 'puppeteer',
    expectedIntervalMin: 24 * 60, // cron: companiesCron()
    watchdogThresholdMin: 24 * 60,
    dailyDeadline: companiesDeadline(), // scrape time + margin
    zeroRowsAllowed: false,
  },
  {
    endpoint: '/circuit-breaks',
    collection: 'circuitbreaks_dses',
    source: 'puppeteer',
    expectedIntervalMin: 5, // cron: '*/5 9-16 * * 0-4'
    watchdogThresholdMin: 15,
    zeroRowsAllowed: true,
  },
  {
    endpoint: '/price-earnings',
    collection: 'price_earnings_dses',
    source: 'puppeteer',
    expectedIntervalMin: 5,
    watchdogThresholdMin: 15,
    zeroRowsAllowed: false,
  },
  {
    endpoint: '/idx',
    collection: 'idx_mds',
    source: 'mysql',
    expectedIntervalMin: 5, // cron: '*/5 9-16 * * 0-4'
    watchdogThresholdMin: 15,
    zeroRowsAllowed: false,
  },
  {
    endpoint: '/trd',
    collection: 'trd_mds',
    source: 'mysql',
    expectedIntervalMin: 5,
    watchdogThresholdMin: 15,
    zeroRowsAllowed: false,
  },
  {
    endpoint: '/man',
    collection: 'man_mds',
    source: 'mysql',
    expectedIntervalMin: 5,
    watchdogThresholdMin: 15,
    zeroRowsAllowed: true,
  },
  {
    endpoint: '/mkistat',
    collection: 'mkistat_mds',
    source: 'mysql',
    expectedIntervalMin: 5,
    watchdogThresholdMin: 15,
    zeroRowsAllowed: false,
  },
];

export const ENDPOINT_PATHS = ENDPOINTS.map((e) => e.endpoint);
export const COLLECTION_NAMES = ENDPOINTS.map((e) => e.collection);
export const SOURCES: EndpointSource[] = ['puppeteer', 'mysql'];
export const ENDPOINT_STATUSES = ['ok', 'partial', 'failed'] as const;
export const OVERALL_STATUSES = ['ok', 'partial', 'failed', 'closed'] as const;

export function getEndpointConfig(
  endpoint: string,
): EndpointConfig | undefined {
  return ENDPOINTS.find((e) => e.endpoint === endpoint);
}

export const STATUS_CONFIG = {
  timezone: TIMEZONE,

  // Sunday = 0 ... Saturday = 6. DSE trades Sunday to Thursday.
  tradingWeekdays: [0, 1, 2, 3, 4],

  // Market open/closed status comes from the DSE site itself (never a local
  // holiday calendar). Session hours are read from it each day; the values
  // below are only a fallback when the site cannot be reached.
  marketStatus: {
    url: 'https://new.dsebd.org/api/live/market',
    timeoutMs: 8000,
    fallbackSession: {
      preOpening: '09:55',
      opening: '10:00',
      closing: '14:00',
      postClosing: '14:10',
    },
  },

  // Consecutive empty MySQL polls (in market hours) before "source returned
  // no rows" is recorded.
  consecutiveEmptyPollLimit: 3,

  // Watchdog runs every 10 minutes via system crontab (not in-process).
  watchdogIntervalMin: 10,

  // End-of-day finalizer, Dhaka HH:mm. Runs every calendar day.
  finalizerTime: '15:05',

  // Max time a status write may take before it is abandoned (ms).
  writeTimeoutMs: 3000,

  // trd_mds holds one market-wide document per day; the finalizer checks that
  // its last update is no earlier than the close minus this many minutes.
  trdLastUpdateToleranceMin: 10,
};
