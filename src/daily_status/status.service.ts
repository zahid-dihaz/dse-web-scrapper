import { Connection } from 'mongoose';
import { STATUS_CONFIG, STATUS_COLLECTION } from './status.config';
import { dhakaDate } from './dhaka-time';
import {
  applyError,
  applyRecovery,
  applySuccess,
  computeOverall,
  applyStale,
  DailyStatusDoc,
  EndpointEntry,
  newEndpointEntries,
} from './status.logic';

// The one module every collector uses to report into daily_status. Public
// methods never throw and never wait longer than writeTimeoutMs: a status
// failure must not crash or block a collector.

const CAS_ATTEMPTS = 3;

export class StatusService {
  constructor(
    private readonly conn: Connection,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private col() {
    if (this.conn.readyState !== 1 || !this.conn.db) {
      throw new Error('mongo connection not ready');
    }
    return this.conn.db.collection<any>(STATUS_COLLECTION);
  }

  private async safe<T>(
    label: string,
    op: () => Promise<T>,
  ): Promise<T | undefined> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        op(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('timed out')),
            STATUS_CONFIG.writeTimeoutMs,
          );
        }),
      ]);
    } catch (err) {
      console.error(`[daily_status] ${label} failed: ${err}`);
      return undefined;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Idempotent: creates the day's document with all endpoints "failed". */
  async initDay(date: string = dhakaDate(this.now())): Promise<boolean> {
    const result = await this.safe(`initDay ${date}`, () =>
      this.insertDay(date),
    );
    return result === true;
  }

  private async insertDay(date: string): Promise<true> {
    const now = this.now();
    try {
      await this.col().updateOne(
        { _id: date },
        {
          $setOnInsert: {
            exchange_open: true,
            overall_status: 'failed',
            generated_at: now,
            updated_at: now,
            endpoints: newEndpointEntries(),
          },
        },
        { upsert: true },
      );
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // lost an upsert race: already exists
    }
    return true;
  }

  async recordSuccess(endpoint: string, rows: number, note?: string) {
    await this.mutate('recordSuccess', endpoint, (e, now) =>
      applySuccess(e, rows, now, note),
    );
  }

  /** `opts.since` writes "<errorType> since HH:mm" instead of "... at HH:mm". */
  async recordError(
    endpoint: string,
    errorType: string,
    detail?: string,
    opts?: { since?: Date },
  ) {
    await this.mutate('recordError', endpoint, (e, now) =>
      applyError(e, errorType, detail, now, opts),
    );
  }

  async recordRecovery(endpoint: string) {
    await this.mutate('recordRecovery', endpoint, (e, now) =>
      applyRecovery(e, now),
    );
  }

  /** Watchdog: flag an endpoint that has not captured since `since`. */
  async markStale(endpoint: string, since: Date) {
    await this.mutate('markStale', endpoint, (e) => applyStale(e, since));
  }

  async getDay(date: string): Promise<DailyStatusDoc | null> {
    const doc = await this.safe(`getDay ${date}`, () =>
      this.col().findOne({ _id: date }),
    );
    return (doc as DailyStatusDoc | null | undefined) ?? null;
  }

  /**
   * Read-modify-write of one endpoint entry, guarded by compare-and-set on the
   * entry's current values so concurrent writers (a collector and the
   * watchdog) never overwrite each other.
   */
  private async mutate(
    label: string,
    endpoint: string,
    change: (entry: EndpointEntry, now: Date) => EndpointEntry,
  ): Promise<void> {
    await this.safe(`${label} ${endpoint}`, async () => {
      const date = dhakaDate(this.now());
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        let doc = await this.col().findOne({ _id: date });
        if (!doc) {
          await this.insertDay(date); // lazily create before the first write
          doc = await this.col().findOne({ _id: date });
        }
        const current: EndpointEntry | undefined = doc?.endpoints?.find(
          (e: EndpointEntry) => e.endpoint === endpoint,
        );
        if (!current) throw new Error(`unknown endpoint ${endpoint}`);

        const now = this.now();
        const next = change(current, now);
        if (next === current) return; // nothing to write

        const res = await this.col().updateOne(
          {
            _id: date,
            endpoints: {
              $elemMatch: {
                endpoint,
                rows: current.rows,
                status: current.status,
                note: current.note,
              },
            },
          },
          { $set: { 'endpoints.$': next, updated_at: now } },
        );
        if (res.matchedCount === 1) {
          await this.refreshOverall(date);
          return;
        }
      }
      throw new Error('too many concurrent updates');
    });
  }

  private async refreshOverall(date: string): Promise<void> {
    const doc = await this.col().findOne({ _id: date });
    if (!doc) return;
    await this.col().updateOne(
      { _id: date },
      {
        $set: {
          overall_status: computeOverall(doc.endpoints),
          updated_at: this.now(),
        },
      },
    );
  }
}
