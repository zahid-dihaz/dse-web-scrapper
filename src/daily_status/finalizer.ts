// Standalone entrypoint, run daily from the system crontab after the close
// (default 15:05 Asia/Dhaka), including weekends and holidays. Imports only
// config, the status service/logic, mongo and the market-hours helper.
//
//   node dist/daily_status/finalizer                # today
//   node dist/daily_status/finalizer 2026-10-08     # manual re-run of a past day
//
// Idempotent: re-running a day rewrites nothing unless something changed.
process.env.TZ = 'Asia/Dhaka';

import { Connection } from 'mongoose';
import { MarketHours } from './market-hours';
import { connectMongo } from './mongo';
import { dhakaDate, dhakaInstant, dhakaTime } from './dhaka-time';
import {
  appendIssue,
  applyStale,
  computeOverall,
  DailyStatusDoc,
  EndpointEntry,
  newEndpointEntries,
} from './status.logic';
import { StatusService } from './status.service';
import { STATUS_COLLECTION, STATUS_CONFIG } from './status.config';
import { findStale } from './watchdog';

const DAY_MS = 24 * 60 * 60 * 1000;
const CAS_ATTEMPTS = 3;

/** What trd_mds holds for the day: one market-wide document, or none. */
export interface TrdSummary {
  lastUpdate: Date;
  totalTrades: number;
  totalVolume: number;
}

export interface FinalizeContext {
  date: string;
  opening: string;
  closing: string;
  trd: TrdSummary | null;
}

/** Pure: apply every end-of-day check to the day's endpoint entries. */
export function finalizeEndpoints(
  entries: EndpointEntry[],
  ctx: FinalizeContext,
): EndpointEntry[] {
  const closeAt = dhakaInstant(ctx.date, ctx.closing);

  // 1. Did every collector keep capturing through the close?
  const stale = new Map(
    findStale({ endpoints: entries }, ctx.date, ctx.opening, closeAt).map(
      (s) => [s.endpoint, s.since],
    ),
  );
  let result = entries.map((e) =>
    stale.has(e.endpoint) ? applyStale(e, stale.get(e.endpoint) as Date) : e,
  );

  // 2. trd_mds sanity: one document for the day, non-zero totals, updated
  //    up to the close.
  const trdProblem = checkTrd(ctx, closeAt);
  if (trdProblem) {
    result = result.map((e) =>
      e.endpoint === '/trd' ? appendIssue(e, trdProblem) : e,
    );
  }

  // 3. Every non-ok endpoint must say why.
  return result.map((e) => {
    if (e.status === 'ok' || e.note) return e;
    return {
      ...e,
      note:
        e.last_success_at === null
          ? 'no captures recorded today'
          : 'incomplete capture, no detail recorded',
    };
  });
}

function checkTrd(ctx: FinalizeContext, closeAt: Date): string | null {
  const { trd } = ctx;
  if (!trd) return `trd_mds has no document for ${ctx.date}`;
  if (!trd.totalTrades || !trd.totalVolume) return 'trd_mds totals are zero';
  const earliest =
    closeAt.getTime() - STATUS_CONFIG.trdLastUpdateToleranceMin * 60_000;
  if (trd.lastUpdate.getTime() < earliest) {
    return `trd_mds last updated ${dhakaTime(trd.lastUpdate)}, before the ${
      ctx.closing
    } close`;
  }
  return null;
}

async function loadTrd(
  conn: Connection,
  date: string,
): Promise<TrdSummary | null> {
  const start = dhakaInstant(date, '00:00');
  const doc = await conn.db
    .collection<any>('trd_mds')
    .find({
      TRD_LM_DATE_TIME: {
        $gte: start,
        $lt: new Date(start.getTime() + DAY_MS),
      },
    })
    .sort({ TRD_LM_DATE_TIME: -1 })
    .limit(1)
    .next();
  return doc
    ? {
        lastUpdate: doc.TRD_LM_DATE_TIME,
        totalTrades: doc.TRD_TOTAL_TRADES,
        totalVolume: doc.TRD_TOTAL_VOLUME,
      }
    : null;
}

export interface FinalizeResult {
  date: string;
  exchange_open: boolean;
  overall_status: DailyStatusDoc['overall_status'];
  changed: boolean;
}

export async function runFinalizer(
  conn: Connection,
  date: string,
  now: Date = new Date(),
  hours: MarketHours = new MarketHours(conn, () => now),
): Promise<FinalizeResult> {
  const col = conn.db.collection<any>(STATUS_COLLECTION);
  const status = new StatusService(conn, () => now);
  const session = await hours.getSession(date);
  let existing = await status.getDay(date);

  // The site only publishes today's status, so a past day without a stored
  // session falls back to what its own record says, then to the weekday rule.
  const open =
    session.source === 'fallback' && existing
      ? existing.exchange_open
      : session.tradingDay;

  if (!open) {
    const closed =
      existing?.exchange_open === false &&
      existing.overall_status === 'closed' &&
      existing.endpoints.length === 0;
    if (!closed) {
      await col.updateOne(
        { _id: date },
        {
          $set: {
            exchange_open: false,
            overall_status: 'closed',
            endpoints: [],
            updated_at: now,
          },
          $setOnInsert: { generated_at: now },
        },
        { upsert: true },
      );
    }
    return {
      date,
      exchange_open: false,
      overall_status: 'closed',
      changed: !closed,
    };
  }

  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
    if (!existing) {
      await status.initDay(date);
      existing = await status.getDay(date);
      if (!existing)
        throw new Error(`could not create status record for ${date}`);
    }
    const base =
      existing.endpoints.length > 0 ? existing.endpoints : newEndpointEntries();
    const endpoints = finalizeEndpoints(base, {
      date,
      opening: session.opening,
      closing: session.closing,
      trd: await loadTrd(conn, date),
    });
    const overall = computeOverall(endpoints);

    const unchanged =
      existing.exchange_open === true &&
      existing.overall_status === overall &&
      JSON.stringify(existing.endpoints) === JSON.stringify(endpoints);
    if (unchanged) {
      return {
        date,
        exchange_open: true,
        overall_status: overall,
        changed: false,
      };
    }

    // Compare-and-set on updated_at so a late collector write is not lost.
    const res = await col.updateOne(
      { _id: date, updated_at: existing.updated_at },
      {
        $set: {
          exchange_open: true,
          overall_status: overall,
          endpoints,
          updated_at: now,
        },
      },
    );
    if (res.matchedCount === 1) {
      return {
        date,
        exchange_open: true,
        overall_status: overall,
        changed: true,
      };
    }
    existing = await status.getDay(date);
  }
  throw new Error(`status record for ${date} kept changing; giving up`);
}

if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    const today = dhakaDate();
    const date = arg ?? today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
      throw new Error(`invalid date "${arg}", expected YYYY-MM-DD`);
    }
    if (date > today) throw new Error(`${date} is in the future`);

    const conn = await connectMongo();
    try {
      const r = await runFinalizer(conn, date);
      console.log(
        `[finalizer] ${r.date}: ${r.exchange_open ? 'open' : 'closed'}, ` +
          `overall ${r.overall_status}${r.changed ? '' : ' (unchanged)'}`,
      );
    } finally {
      await conn.close();
    }
  })().catch((err) => {
    console.error(`[finalizer] failed: ${err}`);
    process.exit(1);
  });
}
