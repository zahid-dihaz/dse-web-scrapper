import { Module } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { MarketHours } from './market-hours';
import { StatusService } from './status.service';

// Nest wiring for collectors that run inside the app. The watchdog and
// finalizer build the same two classes themselves, without Nest.
@Module({
  providers: [
    {
      provide: StatusService,
      inject: [getConnectionToken()],
      useFactory: (conn: Connection) => new StatusService(conn),
    },
    {
      provide: MarketHours,
      inject: [getConnectionToken()],
      useFactory: (conn: Connection) => new MarketHours(conn),
    },
  ],
  exports: [StatusService, MarketHours],
})
export class DailyStatusModule {}
