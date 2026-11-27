// Ask quality test from the command line (search levels; written answers need the native app).
//
//   npm run dev            # in another terminal (http://localhost:5173)
//   BOOKS_PASS=… NODE_PATH=$(npm root -g) node scripts/ask/quality.cjs [--only id,id] [--json out.json]
//
// BOOKS_PASS unlocks the group's books once in a browser profile kept in data-build/quality-profile
// (git-ignored); without it, questions that need the books are skipped. The wiki is used if that
// profile has it installed. The meaning-search model must be in public/models (npm run fetch:models).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const URL_BASE = process.env.APP_URL || 'http://localhost:5173/D-and-D/';
const PROFILE = path.resolve(__dirname, '../../data-build/quality-profile');

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {});
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', String(e)));
  page.on('framenavigated', (f) => f === page.mainFrame() && console.error('navigated:', f.url()));
  page.on('console', (m) => /error|warn/.test(m.type()) && console.error('console:', m.text().slice(0, 300)));
  await page.goto(URL_BASE + '#/library');
  await page.waitForSelector('.book-tile, input[type=password]', { timeout: 60000 });
  if ((await page.$('input[type=password]')) && process.env.BOOKS_PASS) {
    console.error('Unlocking the books (first run only)…');
    await page.fill('input[type=password]', process.env.BOOKS_PASS);
    await page.click('button[type=submit]');
    await page.waitForSelector('.book-tile', { timeout: 600000 });
  }
  await page.goto(URL_BASE + '#/about');
  await page.waitForTimeout(1500);
  const quality = new URL('/src/lib/ask/quality.ts', URL_BASE).href;
  const engine = new URL('/src/lib/ask/engine.ts', URL_BASE).href;
  const only = arg('--only')?.split(',');
  const out = await page.evaluate(
    async ({ quality, engine, only }) => {
      const e = await import(engine);
      await e.downloadAsk(() => {});
      const qm = await import(quality);
      const results = await qm.runQuality({ only });
      return { results, report: qm.report(results) };
    },
    { quality, engine, only },
  );
  console.log(out.report);
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(out.results, null, 1));
  await ctx.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
