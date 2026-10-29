import * as puppeteer from 'puppeteer';
import { Injectable } from '@nestjs/common';

@Injectable()
export default class startBrowserClass {
  async startBrowser() {
    let browser;
    try {
      console.log('Opening the browser......');
      browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        // executablePath: '/usr/bin/google-chrome-stable',
        // headless: false,
        headless: 'new',
        // args: ['--disable-setuid-sandbox'],
        args: ['--no-sandbox'],
        ignoreHTTPSErrors: true,
      });
    } catch (err) {
      console.log('Could not create a browser instance => : ', err);
    }
    return browser;
  }
}
