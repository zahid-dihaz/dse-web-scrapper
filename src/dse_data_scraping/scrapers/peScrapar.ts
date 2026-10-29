import { Injectable } from '@nestjs/common';
import { PeService } from '../services/pe.service';
import { CreatePeDto } from '../dto/pe.dto';
import { ScrapeStructureError } from '../../daily_status/scrape-errors';
import { ScrapeResult } from '../utils/scrape-runner';

@Injectable()
export default class PeScrap {
  constructor(private readonly peService: PeService) {}

  // url = 'https://www.dsebd.org/latest_PE.php';
  url = 'https://old.dsebd.org/latest_PE.php';

  async scraper(browser): Promise<ScrapeResult> {
    let page = await browser.newPage();
    console.log(`Navigating to ${this.url}...`);
    // Navigate to the selected page
    for (;;) {
      const response = await page.goto(this.url);
      console.log('retu', response.status());
      if (response.status() == 200) {
        break;
      }
      page = await browser.newPage();
    }

    // Wait for the required DOM to be rendered
    const scrapeCurrentPage = async (): Promise<ScrapeResult> => {
      console.log('***Scraping Price Earning***');
      await page.waitForSelector('.content');

      let price_earnings_scrap: CreatePeDto[] = [
        {
          company_code: '',
          close_price: '',
          ycp: '',
          pe_1: '',
          pe_2: '',
          pe_3: '',
          pe_4: '',
          pe_5: '',
          pe_6: '',
          trailing_pe: '',
          // created_at: new Date(),
        },
      ];
      price_earnings_scrap = await page.$$eval(
        'table.table.table-bordered.background-white.shares-table.fixedHeader > tbody >tr',
        async (text) => {
          const result = text.map((te) => {
            const value = te.querySelector('td');

            return {
              company_code: value.nextElementSibling.textContent,
              close_price:
                value.nextElementSibling.nextElementSibling.textContent,
              ycp: value.nextElementSibling.nextElementSibling
                .nextElementSibling.textContent,
              pe_1: value.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.textContent,
              pe_2: value.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .textContent,
              pe_3: value.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .nextElementSibling.textContent,
              pe_4: value.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.textContent,
              pe_5: value.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .textContent,
              pe_6: value.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .nextElementSibling.nextElementSibling.nextElementSibling
                .nextElementSibling.textContent,
              trailing_pe:
                value.nextElementSibling.nextElementSibling.nextElementSibling
                  .nextElementSibling.nextElementSibling.nextElementSibling
                  .nextElementSibling.nextElementSibling.nextElementSibling
                  .nextElementSibling.textContent,
            };
          });

          return result;
        },
      );
      if (price_earnings_scrap.length === 0) {
        throw new ScrapeStructureError(
          'table.table.table-bordered.background-white.shares-table.fixedHeader > tbody > tr',
        );
      }

      //! Database insertion'''''''''''''''''''

      await this.peService.upsertPeEntity(price_earnings_scrap);
      console.log('Scraping Price Earning done...!!!');
      return { rows: price_earnings_scrap.length };
    };
    try {
      return await scrapeCurrentPage();
    } finally {
      await page.close().catch(() => undefined); // the browser is closed by the runner
    }
  }
}
