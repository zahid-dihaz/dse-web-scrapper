import CircuitBreakerScraper from '../scrapers/circuitBreakerScrapper';
import ScrapeRunner from '../utils/scrape-runner';
import { Injectable, Inject } from '@nestjs/common';
@Injectable()
export default class CircuitBreakerController {
  constructor(
    @Inject(CircuitBreakerScraper)
    private readonly circuitBreakerScraper: CircuitBreakerScraper,
    private readonly runner: ScrapeRunner,
  ) {}

  async scrapeAll(browserInstance) {
    await this.runner.run('/circuit-breaks', browserInstance, (browser) =>
      this.circuitBreakerScraper.scraper(browser),
    );
  }
}
