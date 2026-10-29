import { Injectable } from '@nestjs/common';
import { MarketHours } from '../../daily_status/market-hours';
import { PollReporter } from '../../daily_status/poll-reporter';
import { StatusService } from '../../daily_status/status.service';
import {
  BrowserLaunchError,
  classifyScrapeError,
} from '../../daily_status/scrape-errors';

export interface ScrapeResult {
  /** Rows stored by this run. */
  rows: number;
  /** Informational note for an ok run, e.g. "no circuit breaks triggered". */
  note?: string;
}

// Runs one scrape for an endpoint: resolves the browser, reports the outcome
// to daily_status, and always closes the browser, even when the launch failed
// or the scrape threw.
@Injectable()
export default class ScrapeRunner {
  private readonly reporters = new Map<string, PollReporter>();

  constructor(
    private readonly status: StatusService,
    private readonly marketHours: MarketHours,
  ) {}

  private reporter(endpoint: string): PollReporter {
    let reporter = this.reporters.get(endpoint);
    if (!reporter) {
      reporter = new PollReporter(this.status, this.marketHours, endpoint);
      this.reporters.set(endpoint, reporter);
    }
    return reporter;
  }

  async run(
    endpoint: string,
    browserInstance: any,
    scrape: (browser: any) => Promise<ScrapeResult>,
  ): Promise<void> {
    const reporter = this.reporter(endpoint);
    let browser;
    try {
      browser = await browserInstance;
      if (!browser) throw new BrowserLaunchError();
      const result = await scrape(browser);
      await reporter.success(result.rows, result.note);
    } catch (err) {
      console.log(`Scraping ${endpoint} failed => `, err);
      await reporter.error(classifyScrapeError(err));
    } finally {
      try {
        await browser?.close();
      } catch {
        // already closed or crashed: nothing left to clean up
      }
    }
  }
}
