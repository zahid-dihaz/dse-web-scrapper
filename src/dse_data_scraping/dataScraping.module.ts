import { Module } from '@nestjs/common';
// import { TypeOrmModule } from '@nestjs/typeorm';

import Browser from './index/browser';
import Index from './index/index';
import ScrapeRunner from './utils/scrape-runner';
import { DailyStatusModule } from '../daily_status/daily-status.module';

import PageController from './middlewares/page.Controller';
import PeController from './middlewares/pe.Controller';
import CircuitBreakerController from './middlewares/circuitBreaker.Controller';

import PageScraper from './scrapers/codeNameScraper';
import PeScraper from './scrapers/peScrapar';
import CircuitBreakerScrapper from './scrapers/circuitBreakerScrapper';

import { CompanyService } from './services/company.service';
import { CompanyScrapeErrorService } from './services/companyScrapeError.service';
import { PeService } from './services/pe.service';
import { CircuitBreakerService } from './services/circuitBreaker.service';
// import { GetService } from './services/delete.service';

// import { Companies } from './entities/company.entities';
// import { Price_earnings } from './entities/pe.entities';
// import { Circuit_breaks } from './entities/circuitBreaker.entities';

import { MongooseModule } from '@nestjs/mongoose';
import { Price_earnings, Price_earningsSchema } from './entities/pe.entities';
import { Companies, CompaniesSchema } from './entities/company.entities';
import {
  CompanyScrapeError,
  CompanyScrapeErrorSchema,
} from './entities/companyScrapeError.entities';
import {
  Circuit_breaks,
  Circuit_breaksSchema,
} from './entities/circuitBreaker.entities';

@Module({
  imports: [
    DailyStatusModule,
    MongooseModule.forFeature([
      { name: Price_earnings.name, schema: Price_earningsSchema },
      { name: Companies.name, schema: CompaniesSchema },
      { name: Circuit_breaks.name, schema: Circuit_breaksSchema },
      { name: CompanyScrapeError.name, schema: CompanyScrapeErrorSchema },
    ]),
  ],
  controllers: [],
  providers: [
    CompanyService,
    CompanyScrapeErrorService,
    PeService,
    CircuitBreakerService,
    PageController,
    PeController,
    CircuitBreakerController,
    PageScraper,
    PeScraper,
    CircuitBreakerScrapper,
    Index,
    Browser,
    ScrapeRunner,
  ],
})
export default class CompanyModule {}
