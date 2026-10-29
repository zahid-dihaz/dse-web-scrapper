// Standalone entrypoint, run from the system crontab (see docs). Deliberately
// imports only config, the status service, mongo and the market-hours helper:
// never the scrapers or pollers, so it keeps working when they are down.
process.env.TZ = 'Asia/Dhaka';

import { Connection } from 'mongoose';
import { MarketHours } from './market-hours';
import { connectMongo } from './mongo';
import { dhakaDate, dhakaInstant } from './dhaka-time';
import { DailyStatusDoc } from './status.logic';
import { StatusService } from './status.service';
import { ENDPOINTS } from './status.config';

export interface StaleEndpoint {
  endpoint: string;
  /** Last capture, or the session opening when there has been none. */
  since: Date;
}

/**
 * Pure: which endpoints have gone quiet. Interval collectors are stale when
 * their last success (or, with none, the session opening) is older than the
 * endpoint's threshold; once-a-day collectors are stale once their deadline
 * has passed without a capture.
 */
export function findStale(
  doc: Pick<DailyStatusDoc, 'endpoints'> | null,
  date: string,
  opening: string,
  now: Date,
): StaleEndpoint[] {
  const openedAt = dhakaInstant(date, opening);
  const stale: StaleEndpoint[] = [];
  for (const cfg of ENDPOINTS) {
    const last =
      doc?.endpoints.find((e) => e.endpoint === cfg.endpoint)
        ?.last_success_at ?? null;
    if (cfg.dailyDeadline) {
      if (!last && now >= dhakaInstant(date, cfg.dailyDeadline)) {
        stale.push({ endpoint: cfg.endpoint, since: openedAt });
      }
      continue;
    }
    const reference = last ?? openedAt;
    if (
      now.getTime() - reference.getTime() >
      cfg.watchdogThresholdMin * 60_000
    ) {
      stale.push({ endpoint: cfg.endpoint, since: reference });
    }
  }
  return stale;
}

export interface WatchdogResult {
  skipped?: 'market closed';
  flagged: string[];
}

export async function runWatchdog(
  conn: Connection,
  now: Date = new Date(),
  hours: MarketHours = new MarketHours(conn, () => now),
): Promise<WatchdogResult> {
  // Outside market hours and on closed days: do nothing at all.
  if (!(await hours.isMarketOpen(now))) {
    return { skipped: 'market closed', flagged: [] };
  }

  const date = dhakaDate(now);
  const status = new StatusService(conn, () => now);
  await status.initDay(date); // a day with no collector at all still gets a record
  const session = await hours.getSession(date);
  const doc = await status.getDay(date);

  const stale = findStale(doc, date, session.opening, now);
  for (const { endpoint, since } of stale) {
    await status.markStale(endpoint, since);
  }
  return { flagged: stale.map((s) => s.endpoint) };
}

// CLI: node dist/daily_status/watchdog [--now 2026-10-07T06:30:00Z]
// `--now` simulates a run at another instant (testing / manual replay).
if (require.main === module) {
  (async () => {
    const i = process.argv.indexOf('--now');
    const now = i > -1 ? new Date(process.argv[i + 1]) : new Date();
    if (isNaN(now.getTime())) throw new Error('invalid --now value');
    const conn = await connectMongo();
    try {
      const result = await runWatchdog(conn, now);
      console.log(
        result.skipped
          ? `[watchdog] ${dhakaDate(now)}: ${result.skipped}, nothing to do`
          : `[watchdog] ${dhakaDate(now)}: flagged ${
              result.flagged.length ? result.flagged.join(', ') : 'nothing'
            }`,
      );
    } finally {
      await conn.close();
    }
  })().catch((err) => {
    console.error(`[watchdog] failed: ${err}`);
    process.exit(1);
  });
}
