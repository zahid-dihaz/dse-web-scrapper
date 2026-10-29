import PageScraper from '../scrapers/codeNameScraper';
import ScrapeRunner from '../utils/scrape-runner';
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export default class PageController {
  constructor(
    @Inject(PageScraper) private readonly pageScraper: PageScraper,
    private readonly runner: ScrapeRunner,
  ) {}

  async scrapeAll(browserInstance) {
    await this.runner.run('/companies', browserInstance, (browser) =>
      this.pageScraper.scraper(browser),
    );
  }
}
