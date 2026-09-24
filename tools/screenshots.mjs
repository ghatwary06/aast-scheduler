// Regenerates docs/screenshots/*.png from the built app.
// Usage: npm run build && npm run preview   (in another terminal), then: node tools/screenshots.mjs
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:4173/app/app.html?demo';
const BROWSER = process.env.BROWSER_PATH ?? '/usr/bin/brave';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: BROWSER, headless: true, defaultViewport: { width: 1440, height: 960 } });
const page = await browser.newPage();
await page.goto(APP, { waitUntil: 'networkidle0' });
await page.waitForSelector('article.card');
const setStrength = async (index, value) => {
  const selects = await page.$$('.rule select.strength');
  await selects[index].select(value);
  await page.waitForNetworkIdle({ idleTime: 200 });
};

await page.screenshot({ path: `${OUT}/overview.png` });
await (await page.$('article.card')).screenshot({ path: `${OUT}/card.png` });
await (await page.$('aside.rules')).screenshot({ path: `${OUT}/rules.png` });

await setStrength(2, 'must'); // "No classes in periods 9-16" becomes required -> nothing fits
await page.waitForSelector('p.broken');
await page.screenshot({ path: `${OUT}/closest-misses.png` });
await setStrength(2, 'prefer');

await page.click('.results-head input[type=checkbox]'); // share mode
await page.waitForNetworkIdle({ idleTime: 200 });
await (await page.$('article.card')).screenshot({ path: `${OUT}/share-card.png` });

await page.click('nav.tabs button:nth-child(2)'); // Data tab
await page.waitForSelector('.groups');
await page.screenshot({ path: `${OUT}/data.png` });

await browser.close();
console.log('screenshots written to', OUT);
