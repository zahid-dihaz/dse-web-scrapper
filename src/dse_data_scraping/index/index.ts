import BrowserObject from './browser';
import { Injectable } from '@nestjs/common';
import ScraperController from '../middlewares/page.Controller';
import PeController from '../middlewares/pe.Controller';
import CircuitBreakerController from '../middlewares/circuitBreaker.Controller';
import { Cron, CronExpression } from '@nestjs/schedule';
import { companiesCron } from '../../daily_status/status.config';

@Injectable()
export default class IndexProvider {
  constructor(
    private readonly browserObject: BrowserObject,
    private readonly scraperController: ScraperController,
    private readonly peController: PeController,
    private readonly circuitBreakerController: CircuitBreakerController,
  ) {}

  //Start the browser and create a browser instance

  @Cron(companiesCron(), {
    // @Cron('*/5 9-15  * * *', {
    timeZone: 'Asia/Dhaka', // Set the desired timezone here
  }) // Sun-Thu at COMPANIES_SCRAPE_TIME (default 10:20 Dhaka).
  async Company_info() {
    console.log('Cron Started in DSE scraping Company Info');
    const browserInstance = this.browserObject.startBrowser();
    // Pass the browser instance to the scraper controller
    this.scraperController.scrapeAll(browserInstance);
  }

  // @Cron('*/2 9-18 * * 0-4', {
  @Cron('*/5 9-16 * * 0-4', {
    timeZone: 'Asia/Dhaka', // Set the desired timezone here
  }) // Starts everyday at 9.30 am from sunday to thursday and repeats after every 5 minutes.
  async Price_earnings() {
    console.log('Cron Started in DSE scraping for Price_earnings');
    const browserInstance = this.browserObject.startBrowser();

    // Pass the browser instance to the scraper controller
    this.peController.scrapeAll(browserInstance);
  }

  // @Cron('*/2 9-18 * * 0-4', {
  @Cron('*/5 9-16 * * 0-4', {
    timeZone: 'Asia/Dhaka', // Set the desired timezone here
  }) // Starts everyday at 9.00 am from sunday to thursday and repeats after every 5 minutes.
  async Circuit_breaker() {
    console.log('Cron Started in DSE scraping for Circuit_breaker');
    const browserInstance = this.browserObject.startBrowser();

    // Pass the browser instance to the scraper controller
    this.circuitBreakerController.scrapeAll(browserInstance);
  }
}
