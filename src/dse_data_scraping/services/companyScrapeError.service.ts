import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CompanyScrapeError,
  CompanyScrapeErrorDocument,
} from '../entities/companyScrapeError.entities';

@Injectable()
export class CompanyScrapeErrorService {
  constructor(
    @InjectModel(CompanyScrapeError.name)
    private errorModel: Model<CompanyScrapeErrorDocument>,
  ) {}

  private today(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(
      new Date(),
    );
  }

  // Never throws: failing to record an error must not break the scrape.
  async record(
    code: string,
    kind: 'not_saved' | 'partial',
    problems: string[],
  ): Promise<void> {
    try {
      await this.errorModel.updateOne(
        { code, recordDate: this.today() },
        { $set: { kind, problems } },
        { upsert: true },
      );
    } catch (error) {
      console.log('Error in companyScrapeError.service (record)');
    }
  }

  // A later rerun scraped the company cleanly, so today's error no longer applies.
  async clear(code: string): Promise<void> {
    try {
      await this.errorModel.deleteOne({ code, recordDate: this.today() });
    } catch (error) {
      console.log('Error in companyScrapeError.service (clear)');
    }
  }
}
