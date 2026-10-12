import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import yazl from 'yazl';
import samples from './sample-files.mjs';
await fs.mkdir('validation', { recursive: true });
const testRoot = await fs.mkdtemp(path.resolve('validation', 'desktop-'));
const library = path.join(testRoot, 'comics'), images = path.join(testRoot, 'webtoon');
await fs.mkdir(library); await fs.mkdir(images);
const pageBytes = await sharp(Buffer.from('<svg width="800" height="1800"><rect width="800" height="1800" fill="#fff"/><rect x="30" y="30" width="740" height="830" fill="#335977"/><rect x="30" y="910" width="740" height="850" fill="#774e50"/></svg>')).png().toBuffer();
async function zip(file) { const archive = new yazl.ZipFile(), out = createWriteStream(file); archive.outputStream.pipe(out); for (const name of ['01.png','02.png','03.png']) archive.addBuffer(pageBytes, name); archive.end(); await finished(out); }
await zip(path.join(library, 'Fixture 1.cbz'));
const batman = path.join(library, 'DC', 'Batman'); await fs.mkdir(batman, { recursive: true });
await zip(path.join(batman, 'Batman 035.cbz')); await zip(path.join(batman, 'Batman 036.cbz'));
for (let i = 0; i < 3; i++) await fs.writeFile(path.join(images, `${i + 1}.png`), pageBytes);
await sharp({ create: { width: 400, height: 18000, channels: 3, background: '#335977' } }).png().toFile(path.join(images, '4-long.png'));
const standaloneImage = path.join(testRoot, 'standalone-webtoon.png'); await fs.copyFile(path.join(images, '4-long.png'), standaloneImage);
const standaloneJpg = path.join(testRoot, 'standalone-page.jpg'); await sharp({ create: { width: 600, height: 900, channels: 3, background: '#6b496f' } }).jpeg().toFile(standaloneJpg);
const env = { ...process.env, PANEL_READER_DATA: path.join(testRoot, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.PANEL_READER_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, timeout: 60000 });
const failures = [], checks = [];
const page = await app.firstWindow(); page.setDefaultTimeout(20000);
page.on('pageerror', e => failures.push(e.message));
app.process().stderr.on('data', data => { const text = data.toString(); if (/Error|error|uncaught/i.test(text)) console.log('Electron:', text.trim().slice(0, 1000)); });
const dialogFiles = files => app.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths }); }, files);
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS:', name); };
const openBatmanFolder = async () => {
  await page.locator('.folder-card').filter({ hasText: 'DC' }).click();
  await page.locator('.folder-card').filter({ hasText: 'Batman' }).click();
};
try {
  await check('desktop launches with empty library', async () => { await expect(page.getByText('Your next story starts here.')).toBeVisible(); await page.screenshot({ path: 'validation/ui-empty.png' }); });
  await check('recursive scan preserves clickable nested folders and discovers new comics', async () => {
    await dialogFiles([library]); await page.locator('.library-top').getByRole('button', { name: 'Add library folder' }).click();
    await expect(page.locator('.folder-card')).toHaveCount(1); await expect(page.locator('.book-card')).toHaveCount(1);
    await openBatmanFolder(); await expect(page.locator('.book-card')).toHaveCount(2);
    await expect(page.locator('.library-title')).toContainText('Batman');
    await page.getByRole('button', { name: /Home/ }).first().click();
    await zip(path.join(library, 'Fixture 2.cbz')); await page.keyboard.press('F5'); await page.locator('.folder-select').filter({ hasText: 'comics' }).click(); await expect(page.locator('.book-card')).toHaveCount(2);
    await page.getByRole('button', { name: /Home/ }).first().click();
  });
  await check('series history queues the next issue', async () => {
    await openBatmanFolder();
    await page.locator('.book-card').filter({ hasText: 'Batman 035' }).click(); await expect(page.locator('.reader-title strong')).toContainText('Batman 035');
    await page.keyboard.press('l'); await page.getByRole('button', { name: /Home/ }).first().click(); await expect(page.locator('.up-next')).toContainText('Batman 035'); await expect(page.locator('.up-next')).toContainText('Page 1 of 3');
    await page.getByRole('button', { name: /History/ }).first().click(); await expect(page.locator('.book-card')).toHaveCount(1); await expect(page.locator('.book-card')).toContainText('Batman 035');
    await page.getByRole('button', { name: /Home/ }).first().click();
  });
  await check('Up and Down scroll within a page by the configured amount', async () => {
    await page.locator('.folder-select').filter({ hasText: 'comics' }).click(); await page.locator('.book-card').first().click(); await expect(page.locator('.page-count')).toContainText('Page 1'); await page.keyboard.press('w');
    await expect(page.locator('.page-art img')).toBeVisible(); await page.keyboard.press('ArrowDown');
    await expect.poll(() => page.locator('.reading-viewport').evaluate(e => Math.round(e.scrollTop))).toBe(160);
    await expect(page.locator('.page-count')).toContainText('Page 1'); await page.keyboard.press('ArrowUp');
    await expect.poll(() => page.locator('.reading-viewport').evaluate(e => Math.round(e.scrollTop))).toBe(0);
  });
  await check('preferences update background, scrolling, and next-page binding', async () => {
    await page.keyboard.press('Control+,'); await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toBeVisible();
    await page.getByLabel('Scroll distance', { exact: true }).fill('240');
    await page.getByLabel('Reading background', { exact: true }).fill('#243142');
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await page.getByRole('button', { name: 'Shortcut for Next page / panel', exact: true }).click(); await page.keyboard.press('j');
    await expect(page.getByRole('button', { name: 'Shortcut for Next page / panel', exact: true })).toHaveText('J');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('.reading-viewport')).toHaveCSS('background-color','rgb(36, 49, 66)'); await page.keyboard.press('j'); await expect(page.locator('.page-count')).toContainText('Page 2');
    await expect(page.locator('.page-art img').first()).toHaveAttribute('src', /\/1\/image$/);
    await page.keyboard.press('ArrowDown'); await expect.poll(() => page.locator('.reading-viewport').evaluate(e => Math.round(e.scrollTop))).toBe(240);
  });
  await check('fullscreen contains no toolbar, counter, or overlay', async () => {
    await page.keyboard.press('F11'); await expect(page.locator('.reader-toolbar')).toHaveCount(0); await expect(page.locator('.reader-footer')).toHaveCount(0); await expect(page.locator('.toast')).toHaveCount(0);
    await page.keyboard.press('Tab'); await expect(page.locator('.reader-toolbar')).toBeVisible(); await page.keyboard.press('F11');
  });
  await check('real CBZ opens and guided Next changes panel before page', async () => {
    await dialogFiles([samples[0]]); await page.keyboard.press('Control+o'); await expect(page.locator('.reader-title strong')).toContainText('Ben 10');
    await page.keyboard.press('g'); await page.getByLabel('Page number', { exact: true }).fill('5'); await page.getByRole('button', { name: 'Go to page', exact: true }).click();
    await page.keyboard.press('p'); await expect(page.locator('.reader-status')).toContainText(/panels detected|Page overview/, { timeout: 60000 });
    await expect(page.locator('.page-count')).toContainText('Panel 1'); await page.keyboard.press('j'); await expect(page.locator('.page-count')).toContainText('Panel 2'); await expect(page.locator('.page-count')).toContainText('Page 5');
    await page.screenshot({ path:'validation/ui-guided.png' });
  });
  await check('manual panel order persists', async () => {
    await page.keyboard.press('e'); await expect(page.getByRole('dialog', { name:'Edit panels', exact:true })).toBeVisible();
    await page.screenshot({ path:'validation/ui-editor.png' });
    await page.locator('.panel-list button').nth(1).click(); await page.getByRole('button', { name:'Earlier', exact:true }).click(); await page.getByRole('button', { name:'Save panels', exact:true }).click();
    await expect(page.locator('.reader-status')).toContainText('Your panel layout');
    await page.keyboard.press('PageDown'); await expect(page.locator('.page-count')).toContainText('Page 6'); await page.keyboard.press('PageUp');
    await expect(page.locator('.reader-status')).toContainText('Your panel layout');
  });
  await check('polygon corrections can be drawn and saved', async () => {
    await page.keyboard.press('e'); await expect(page.getByRole('dialog', { name:'Edit panels', exact:true })).toBeVisible();
    const count = await page.locator('.panel-list button').count();
    await page.getByRole('button', { name:'Draw polygon', exact:true }).click();
    const bounds = await page.locator('.drawing').boundingBox();
    for (const [x,y] of [[.12,.12],[.45,.16],[.40,.32],[.16,.28]]) await page.mouse.click(bounds.x + x * bounds.width, bounds.y + y * bounds.height);
    await page.keyboard.press('Enter'); await expect(page.locator('.panel-list button')).toHaveCount(count + 1);
    await page.getByRole('button', { name:'Save panels', exact:true }).click(); await expect(page.locator('.reader-status')).toContainText('Your panel layout');
    await expect(page.getByRole('dialog', { name:'Edit panels', exact:true })).toHaveCount(0);
  });
  await check('real CBR reads and fits width and height', async () => {
    await dialogFiles([samples[2]]); await page.keyboard.press('Control+o'); await expect(page.locator('.reader-title strong')).toContainText('Super Sons');
    await page.keyboard.press('p'); await page.keyboard.press('h'); await expect(page.locator('.page-art img')).toBeVisible();
    await expect.poll(() => page.locator('.page-art img').first().evaluate(e => e.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path:'validation/ui-reader.png' });
  });
  await check('webtoon supports individual pages and a stitched 18,000px image', async () => {
    await dialogFiles([images]); await page.keyboard.press('Control+Alt+o'); await expect(page.locator('.reader-title strong')).toContainText('webtoon'); await page.keyboard.press('t');
    await expect(page.locator('.webtoon-page')).toHaveCount(4); await expect(page.locator('.webtoon-page img').first()).toBeVisible();
    await page.keyboard.press('End'); await expect(page.locator('.page-count')).toContainText('Page 4');
    await expect(page.locator('.webtoon-page[data-page="3"] img')).toHaveCount(5); await expect.poll(() => page.locator('.webtoon-page[data-page="3"] img').first().evaluate(e => e.naturalHeight)).toBeGreaterThan(0);
    await page.keyboard.press('w');
    await expect.poll(() => page.evaluate(() => Math.round(document.querySelector('.webtoon-stack').getBoundingClientRect().width - (document.querySelector('.reading-viewport').clientWidth - 32)))).toBe(0);
    await page.keyboard.press('h'); const heightFitOne = await page.locator('.webtoon-stack').evaluate(e => e.getBoundingClientRect().width);
    await expect(page.locator('.zoom-tools')).toContainText('125%');
    await page.keyboard.press('h'); const heightFitTwo = await page.locator('.webtoon-stack').evaluate(e => e.getBoundingClientRect().width); expect(heightFitTwo).toBeLessThan(heightFitOne);
    await expect(page.locator('.zoom-tools')).toContainText('100%');
    await page.screenshot({ path:'validation/ui-webtoon.png' });
  });
  await check('webtoon position survives returning to library and switching reading modes', async () => {
    await page.keyboard.press('ArrowDown');
    const before = await page.locator('.reading-viewport').evaluate(e => e.scrollTop);
    await page.keyboard.press('l'); await expect(page.locator('.library-main')).toBeVisible();
    await page.getByRole('button', { name: /Home/ }).first().click();
    await expect(page.locator('.up-next')).toContainText('Page 4');
    await page.keyboard.press('l'); await expect(page.locator('.page-count')).toContainText('Page 4');
    await expect.poll(() => page.locator('.reading-viewport').evaluate(e => e.scrollTop)).toBeGreaterThan(0);
    await page.keyboard.press('t'); await expect(page.locator('.page-art img')).toHaveCount(5);
    await page.keyboard.press('t'); await expect(page.locator('.page-count')).toContainText('Page 4');
    expect(before).toBeGreaterThan(0);
  });
  await check('standalone JPG and PNG open directly, with tall images using webtoon mode', async () => {
    await page.keyboard.press('t');
    await dialogFiles([standaloneJpg]); await page.keyboard.press('Control+o'); await expect(page.locator('.reader-title strong')).toContainText('standalone-page'); await expect(page.locator('.page-art img')).toBeVisible();
    await dialogFiles([standaloneImage]); await page.keyboard.press('Control+o'); await expect(page.locator('.reader-title strong')).toContainText('standalone-webtoon');
    await expect(page.locator('.reader-title')).toContainText('Continuous scroll'); await expect(page.locator('.webtoon-page')).toHaveCount(1);
    await expect(page.locator('.webtoon-page img')).toHaveCount(5); await expect.poll(() => page.locator('.webtoon-page img').first().evaluate(e => e.naturalHeight)).toBeGreaterThan(0);
  });
  await check('library covers render and reading settings persist to disk', async () => {
    await page.keyboard.press('l'); await expect(page.locator('.library-main')).toBeVisible();
    await expect.poll(() => page.locator('.book-card img').first().evaluate(e => e.naturalWidth)).toBeGreaterThan(0);
    await page.screenshot({ path:'validation/ui-library.png' });
    const state = JSON.parse(await fs.readFile(path.join(testRoot,'data','library.json'),'utf8')); expect(state.settings.shortcuts.next).toBe('J'); expect(state.settings.scrollAmount).toBe(240); expect(state.settings.background).toBe('#243142');
  });
  await check('library roots can be changed and removed', async () => {
    await dialogFiles([library]); await page.getByRole('button', { name: /Change comics folder/ }).click(); await expect(page.locator('.folder-select').filter({ hasText: 'comics' })).toBeVisible();
    await page.getByRole('button', { name: /Remove comics folder/ }).click(); await expect(page.getByRole('dialog', { name: 'Remove library folder' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove folder', exact: true }).click(); await expect(page.locator('.folder-select')).toHaveCount(0);
  });
  expect(failures).toEqual([]);
} catch (e) { failures.push(e.stack); await page.screenshot({ path:'validation/ui-failure.png' }).catch(() => {}); console.error(e); process.exitCode = 1; }
finally { await app.close(); await fs.writeFile(executablePath ? 'validation/packaged-desktop-report.json' : 'validation/desktop-report.json', JSON.stringify({ executablePath, checks, failures, testRoot }, null, 2)); }
