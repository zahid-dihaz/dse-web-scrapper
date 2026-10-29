import { Injectable } from '@nestjs/common';
import { CircuitBreakerService } from '../services/circuitBreaker.service';
import { CreateCircuitBreakerDto } from '../dto/circuitBreaker.dto';
import { ScrapeStructureError } from '../../daily_status/scrape-errors';
import { ScrapeResult } from '../utils/scrape-runner';
@Injectable()
export default class CircuitBreakerScraper {
  constructor(private readonly circuitBreakerService: CircuitBreakerService) {
    // this.scraperObject = {
    //   peService: this.peService,
    // };
  }

  // url = 'https://www.dsebd.org/cbul.php';
  url = 'https://old.dsebd.org/cbul.php';

  // async scraper(browser) {
  //   const page = await browser.newPage();
  //   console.log(`Navigating to ${this.url}...`);
  //   // Navigate to the selected page
  //   await page.goto(this.url);
  //   // Wait for the required DOM to be rendered
  //   const scrapeCurrentPage = async () => {
  //     console.log('**Scraping CircuitBreaker**');
  //     await page.waitForSelector('.content');
  //     let circuit_breaker: CreateCircuitBreakerDto[] = [
  //       {
  //         trade_code: ' ',
  //         breaker: ' ',
  //         tickSize: ' ',
  //         openAdjPrice: ' ',
  //         floorPrice: ' ',
  //         lowerLimit: ' ',
  //         upperLimit: ' ',
  //         floorPriceBlockMarket: ' ',
  //       },
  //     ];
  //     circuit_breaker = await page.$$eval(
  //       'table.table.table-bordered.background-white.text-center > tbody >tr',
  //       async (text) => {
  //         const result = text.slice(2).map((te) => {
  //           const value = te.querySelector('td');
  //           return {
  //             // id: value.textContent,
  //             trade_code: value.nextElementSibling.textContent,
  //             breaker: value.nextElementSibling.nextElementSibling.textContent,
  //             tickSize:
  //               value.nextElementSibling.nextElementSibling.nextElementSibling
  //                 .textContent,
  //             openAdjPrice:
  //               value.nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.textContent,
  //             floorPrice:
  //               value.nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.nextElementSibling.textContent,
  //             lowerLimit:
  //               value.nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.nextElementSibling.nextElementSibling
  //                 .textContent,
  //             upperLimit:
  //               value.nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.textContent,
  //             floorPriceBlockMarket:
  //               value.nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.nextElementSibling.nextElementSibling
  //                 .nextElementSibling.nextElementSibling.textContent,
  //           };
  //         });
  //         // await page.close();
  //         return result;
  //       },
  //     );
  //     console.log('Scraping CircuitBreaker done...!!!');
  //     await browser.close(); //Closing the browser Instance.
  //     const is_created =
  //       await this.circuitBreakerService.upsertCircuitBreakerEntity(
  //         circuit_breaker,
  //       );
  //   };
  //   const data = await scrapeCurrentPage();
  // }

  async scraper(browser): Promise<ScrapeResult> {
    const page = await browser.newPage();

    // page.on('console', (message) => {
    //   console.log('[Browser console]:', message.text());
    // });

    page.on('pageerror', (error) => {
      console.error('[Page error]:', error.message);
    });

    page.on('requestfailed', (request) => {
      console.error(
        '[Request failed]:',
        request.url(),
        request.failure()?.errorText,
      );
    });

    try {
      console.log(`Navigating to ${this.url}...`);

      const response = await page.goto(this.url, {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      });

      console.log('Response status:', response?.status());

      await page.waitForSelector(
        'table.table.table-bordered.background-white.text-center > tbody > tr',
        {
          timeout: 30_000,
        },
      );

      const rows = await page.$$eval(
        'table.table.table-bordered.background-white.text-center > tbody > tr',
        (elements) => {
          return elements.map((row, rowIndex) => {
            const cells = Array.from(
              row.querySelectorAll('td'),
              function (cell) {
                return ((cell as HTMLElement).textContent ?? '').trim();
              },
            );

            return {
              rowIndex,
              cellCount: cells.length,
              cells,
            };
          });
        },
      );

      // console.log('Total rows found:', rows.length);

      // rows.forEach((row) => {
      //   console.log(`Row ${row.rowIndex}, cells: ${row.cellCount}`, row.cells);
      // });

      // const invalidRows = rows.filter(
      //   (row) => row.rowIndex >= 2 && row.cellCount < 9,
      // );

      // if (invalidRows.length > 0) {
      //   console.error('Rows with missing columns:', invalidRows);
      // }

      const circuitBreaker: CreateCircuitBreakerDto[] = rows
        .slice(2)
        .filter((row) => row.cellCount >= 7)
        .map((row) => ({
          trade_code: row.cells[1],
          breaker: row.cells[2],
          tickSize: row.cells[3],
          openAdjPrice: row.cells[4],
          // floorPrice: row.cells[5],
          lowerLimit: row.cells[5],
          upperLimit: row.cells[6],
          // floorPriceBlockMarket: row.cells[8],
        }));

      if (circuitBreaker.length === 0) {
        // Zero rows is only legitimate when the table itself loaded and its
        // header parsed; a missing table must still fail.
        const headers = await page.$$eval(
          'table.table.table-bordered.background-white.text-center th',
          (ths) => ths.map((th) => (th.textContent ?? '').trim()),
        );
        if (!headers.some((h) => /trade code/i.test(h))) {
          throw new ScrapeStructureError('"Trade Code" table header');
        }
        console.log('No circuit breaks triggered');
        return { rows: 0, note: 'no circuit breaks triggered' };
      }

      const result =
        await this.circuitBreakerService.upsertCircuitBreakerEntity(
          circuitBreaker,
        );

      console.log('Database upsert result:', result);
      return { rows: circuitBreaker.length };
    } catch (error) {
      console.error('Circuit breaker scraping failed:', error);

      // Diagnostics only: must not mask the original error (e.g. a crashed
      // browser makes both of these throw too).
      try {
        await page.screenshot({
          path: `circuit-breaker-error-${Date.now()}.png`,
          fullPage: true,
        });

        const html = await page.content();
        console.log('Page HTML length:', html.length);
      } catch (diagnosticError) {
        console.error('Could not capture diagnostics:', diagnosticError);
      }

      throw error;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}
