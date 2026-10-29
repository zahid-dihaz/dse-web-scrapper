import { MarketHours } from './market-hours';
import { StatusService } from './status.service';
import { ClassifiedError } from './mysql-errors';
import { getEndpointConfig, STATUS_CONFIG } from './status.config';

// Per-endpoint glue between a poller and the status service: gates reporting
// to the market session, counts consecutive empty polls, and writes the
// recovery note after an error. Never throws.

export class PollReporter {
  private emptyCount = 0;
  private emptySince: Date | undefined;
  // True after an error, and on startup (a restart may follow an outage whose
  // note is still waiting for its recovery text; recordRecovery is a no-op
  // when there is nothing to recover).
  private needsRecovery = true;

  constructor(
    private readonly status: StatusService,
    private readonly hours: MarketHours,
    private readonly endpoint: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async active(): Promise<boolean> {
    try {
      return await this.hours.inReportingWindow(this.now());
    } catch (err) {
      console.error(
        `[daily_status] ${this.endpoint} window check failed: ${err}`,
      );
      return true; // never hide a failure because the calendar check broke
    }
  }

  /** A poll/scrape finished and its rows (possibly zero) were stored. */
  async success(rows: number, note?: string): Promise<void> {
    if (!(await this.active())) return;
    const cfg = getEndpointConfig(this.endpoint);
    await (note
      ? this.status.recordSuccess(this.endpoint, rows, note)
      : this.status.recordSuccess(this.endpoint, rows));

    if (rows > 0) {
      this.emptyCount = 0;
      this.emptySince = undefined;
      if (this.needsRecovery) {
        await this.status.recordRecovery(this.endpoint);
        this.needsRecovery = false;
      }
      return;
    }

    this.emptyCount++;
    this.emptySince ??= this.now();
    const limit = STATUS_CONFIG.consecutiveEmptyPollLimit;
    if (!cfg?.zeroRowsAllowed && this.emptyCount >= limit) {
      this.needsRecovery = true;
      await this.status.recordError(
        this.endpoint,
        'source returned no rows',
        undefined,
        { since: this.emptySince },
      );
    }
  }

  /** The poll failed (connect, query or Mongo write). */
  async error(failure: ClassifiedError): Promise<void> {
    if (!(await this.active())) return;
    this.needsRecovery = true;
    await this.status.recordError(this.endpoint, failure.label, failure.detail);
  }
}
