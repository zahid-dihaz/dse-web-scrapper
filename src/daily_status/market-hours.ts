import { Connection } from 'mongoose';
import { fetchMarketSession, MarketSession } from './market-session';
import { SESSION_COLLECTION, STATUS_CONFIG } from './status.config';
import {
  dhakaDate,
  dhakaMinutes,
  hhmmToMinutes,
  weekdayOf,
} from './dhaka-time';

// Market open/closed status per Dhaka date, as published by the DSE site and
// stored once a day in market_sessions. No holiday calendar: if the site
// cannot be reached and nothing is stored yet, the weekday rule plus the
// fallback hours are used (day treated as open, so failures are never hidden)
// and nothing is stored, so the next call tries the site again.

export interface DaySession {
  date: string;
  tradingDay: boolean;
  preOpening: string;
  opening: string;
  closing: string;
  postClosing: string;
  source: 'db' | 'site' | 'fallback';
}

const FALLBACK_RETRY_MS = 60_000;

export class MarketHours {
  private cache = new Map<string, DaySession>();
  private inflight = new Map<string, Promise<DaySession>>();
  private lastFallbackAt = new Map<string, number>();

  constructor(
    private readonly conn: Connection,
    private readonly now: () => Date = () => new Date(),
    private readonly fetcher: () => Promise<MarketSession> = fetchMarketSession,
  ) {}

  async getSession(date: string = dhakaDate(this.now())): Promise<DaySession> {
    const cached = this.cache.get(date);
    if (cached) return cached;
    let pending = this.inflight.get(date);
    if (!pending) {
      pending = this.load(date).finally(() => this.inflight.delete(date));
      this.inflight.set(date, pending);
    }
    return pending;
  }

  async isTradingDay(date: string = dhakaDate(this.now())): Promise<boolean> {
    return (await this.getSession(date)).tradingDay;
  }

  /** Trading day and inside [opening, closing] Dhaka time. */
  async isMarketOpen(at: Date = this.now()): Promise<boolean> {
    return this.within(at, 'opening', 'closing');
  }

  /** Trading day and inside [preOpening, postClosing]: when status is reported. */
  async inReportingWindow(at: Date = this.now()): Promise<boolean> {
    return this.within(at, 'preOpening', 'postClosing');
  }

  private async within(
    at: Date,
    from: keyof DaySession,
    to: keyof DaySession,
  ): Promise<boolean> {
    const session = await this.getSession(dhakaDate(at));
    if (!session.tradingDay) return false;
    const minutes = dhakaMinutes(at);
    return (
      minutes >= hhmmToMinutes(session[from] as string) &&
      minutes <= hhmmToMinutes(session[to] as string)
    );
  }

  private fallback(date: string): DaySession {
    return {
      date,
      tradingDay: STATUS_CONFIG.tradingWeekdays.includes(weekdayOf(date)),
      ...STATUS_CONFIG.marketStatus.fallbackSession,
      source: 'fallback',
    };
  }

  private async load(date: string): Promise<DaySession> {
    try {
      const col = this.conn.db.collection<any>(SESSION_COLLECTION);
      const stored = await col.findOne({ _id: date });
      if (stored) return this.remember(this.fromDoc(stored));

      // Only today's status can be fetched; the site publishes no history.
      if (date !== dhakaDate(this.now())) return this.fallback(date);
      const last = this.lastFallbackAt.get(date);
      if (last && this.now().getTime() - last < FALLBACK_RETRY_MS) {
        return this.fallback(date);
      }

      const site = await this.fetcher();
      if (site.date !== date) {
        throw new Error(`site reported ${site.date}, expected ${date}`);
      }
      const doc = {
        trading_day: site.tradingDay,
        is_open: site.isOpen,
        phase: site.phase,
        pre_opening: site.times.preOpening ?? null,
        opening: site.times.opening ?? null,
        closing: site.times.closing ?? null,
        post_closing: site.times.postClosing ?? null,
        fetched_at: site.fetchedAt,
      };
      await col.updateOne(
        { _id: date },
        { $setOnInsert: doc },
        { upsert: true },
      );
      return this.remember(this.fromDoc({ _id: date, ...doc }, 'site'));
    } catch (err) {
      console.error(
        `[daily_status] market status for ${date} unavailable: ${err}`,
      );
      this.lastFallbackAt.set(date, this.now().getTime());
      return this.fallback(date);
    }
  }

  private remember(session: DaySession): DaySession {
    this.cache.set(session.date, session);
    return session;
  }

  private fromDoc(doc: any, source: 'db' | 'site' = 'db'): DaySession {
    const fb = STATUS_CONFIG.marketStatus.fallbackSession;
    return {
      date: doc._id,
      tradingDay: doc.trading_day,
      preOpening: doc.pre_opening ?? fb.preOpening,
      opening: doc.opening ?? fb.opening,
      closing: doc.closing ?? fb.closing,
      postClosing: doc.post_closing ?? fb.postClosing,
      source,
    };
  }
}
