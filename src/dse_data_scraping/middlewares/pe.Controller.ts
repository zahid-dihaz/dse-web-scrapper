import PeScraper from '../scrapers/peScrapar';
import ScrapeRunner from '../utils/scrape-runner';
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export default class PeController {
  constructor(
    @Inject(PeScraper) private readonly peScraper: PeScraper,
    private readonly runner: ScrapeRunner,
  ) {}

  async scrapeAll(browserInstance) {
    await this.runner.run('/price-earnings', browserInstance, (browser) =>
      this.peScraper.scraper(browser),
    );
  }
}
