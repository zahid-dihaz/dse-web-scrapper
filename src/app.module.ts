import { Logger, Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScheduleModule } from '@nestjs/schedule';
import DataScrapingModule from './dse_data_scraping/dataScraping.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Connection } from 'mongoose';

const logger = new Logger('MongoDB');

@Module({
  imports: [
    DataScrapingModule,
    // MongooseModule.forRoot(
    //   // 'mongodb://admin:dseMngDb4tP!@89.117.36.92:27017/dse_exp?authMechanism=DEFAULT',
    //   'mongodb://dseuser:dseDbPassword!@72.62.255.84:27017/dse_db',
    // ),
    // MongooseModule.forRoot('mongodb://host.docker.internal:27017/book_nest'), // for Docker
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const uri = configService.get<string>('MONGO_URI');

        if (!uri) {
          throw new Error('MONGO_URI is not defined');
        }

        return {
          uri,
          connectionFactory: (connection: Connection) => {
            if (connection.readyState === 1) {
              logger.log('MongoDB is already connected');
            }

            connection.on('connected', () => {
              logger.log('MongoDB connected successfully');
            });

            connection.on('error', (err) => {
              logger.error(`MongoDB connection error: ${err}`);
            });

            return connection;
          },
        };
      },
    }),
    ScheduleModule.forRoot(),
    ConfigModule.forRoot({
      envFilePath: ['.env'],
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
