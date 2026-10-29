import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CompanyScrapeErrorDocument = CompanyScrapeError & Document;

@Schema({
  collection: 'company_scrape_errors',
  timestamps: true, // Enables createdAt and updatedAt fields
})
export class CompanyScrapeError {
  @Prop({ type: String })
  code: string;

  // Dhaka date (YYYY-MM-DD) of the run, same format as Companies.recordDate
  @Prop({ type: String })
  recordDate: string;

  // not_saved: page failed twice, nothing stored. partial: stored with gaps.
  @Prop({ type: String, enum: ['not_saved', 'partial'] })
  kind: string;

  @Prop({ type: [String] })
  problems: string[];

  @Prop()
  createdAt: Date;

  @Prop()
  updatedAt: Date;
}

export const CompanyScrapeErrorSchema =
  SchemaFactory.createForClass(CompanyScrapeError);

CompanyScrapeErrorSchema.index({ code: 1, recordDate: 1 }, { unique: true });
