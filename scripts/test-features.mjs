import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { scanFolders } from '../core/library.mjs';
import { DEFAULT_SETTINGS } from '../core/settings.mjs';
import { openArchive } from '../core/archive.mjs';

await fs.mkdir('validation', { recursive: true });
const root = await fs.mkdtemp(path.resolve('validation/features-'));
const library = path.join(root, 'Comics'), saved = path.join(root, 'Saved'), data = path.join(root, 'data');
for (const folder of [library, saved, data]) await fs.mkdir(folder);
const bytes = await sharp({ create: { width: 800, height: 1200, channels: 3, background: '#335977' } }).jpeg({ quality: 97 }).toBuffer();
const zip = new yazl.ZipFile(), stream = createWriteStream(path.join(library, 'Issue 01.cbz'));
zip.outputStream.pipe(stream); zip.addBuffer(bytes, 'nested/008.JPG'); zip.addBuffer(bytes, 'nested/016.JPG'); zip.end(); await finished(stream);
const longFile = path.join(library, 'Tall image.png');
const longBytes = await sharp({ create: { width: 400, height: 18000, channels: 3, background: '#496b60' } }).png().toBuffer();
await fs.writeFile(longFile, longBytes);
const { books } = await scanFolders([library]);
await fs.writeFile(path.join(data, 'library.json'), JSON.stringify({ folders: [library], books, settings: { ...DEFAULT_SETTINGS, panelPadding: 0, shapeDetection: !!process.env.PANEL_READER_JITTER_SAMPLE } }));
const env = { ...process.env, PANEL_READER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ ...(process.env.PANEL_READER_EXE ? { executablePath: process.env.PANEL_READER_EXE, args: [] } : { args: ['.'] }), env, timeout: 60000 });
let app = await launch(), page = await app.firstWindow();
page.setDefaultTimeout(30000);
const checks = [], errors = [], panelChecks = [];
page.on('pageerror', error => errors.push(error.message));
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS:', name); };
const favorites = () => page.locator('.sidebar .nav-item').filter({ hasText: 'Favorites' });
const issues = async () => { await page.locator('.sidebar .nav-item').first().click(); await page.locator('.folder-card').filter({ hasText: 'Comics' }).click(); };
const goTo = async number => {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('g'); await page.getByLabel('Page number', { exact: true }).fill(String(number));
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.locator('.page-count')).toContainText(`Page ${number}`);
};
async function stablePanel(label) {
  await expect(page.locator('.page-art')).toBeVisible();
  const samples = await page.evaluate(async () => {
    const values = [];
    for (let frame = 0; frame < 90; frame++) {
      await new Promise(requestAnimationFrame);
      const v = document.querySelector('.reading-viewport'), r = document.querySelector('.page-art').getBoundingClientRect();
      values.push([r.width, r.height, v.clientWidth, v.clientHeight, v.scrollLeft, v.scrollTop].map(n => Math.round(n * 100) / 100));
    }
    return values;
  });
  expect(new Set(samples.slice(15).map(JSON.stringify)).size, label).toBe(1);
  panelChecks.push({ label, sampledFrames: samples.length, stableFrames: samples.length - 15, dimensionsAndScroll: samples.at(-1) });
}
try {
  await check('version label comes from package metadata', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
    await expect(page.locator('.library-footer b')).toHaveText(pkg.version);
  });
  await check('upload is hidden without sharing; format and folder-name tooltips are visible', async () => {
    await expect(page.getByRole('button', { name: 'Upload progress', exact: true })).toHaveCount(0);
    await expect(page.locator('.folder-select>span')).toHaveAttribute('title', 'Comics');
    await expect(page.locator('.folder-card-copy strong')).toHaveAttribute('title', 'Comics');
    await issues(); await expect(page.locator('.book-format').filter({ hasText: 'CBZ' })).toHaveCount(1);
  });
  await check('the hover control marks an unopened comic read and unread without opening the reader', async () => {
    const tile = page.locator('.book-tile').filter({ hasText: 'Issue 01' });
    await tile.hover(); await page.getByRole('button', { name: 'Mark read: Issue 01', exact: true }).click();
    await expect(tile.locator('.book-card')).toHaveClass(/is-read/); await expect(tile.locator('.book-meta')).toContainText('Read');
    const state = await page.evaluate(() => window.reader.state()); expect(state.books.find(b => b.title === 'Issue 01').pageCount).toBe(2);
    await page.screenshot({ path: 'validation/ui-manual-read.png' });
    await page.getByRole('button', { name: 'Mark unread: Issue 01', exact: true }).click();
    await expect(tile.locator('.book-card')).not.toHaveClass(/is-read/); await expect(tile.locator('.book-meta')).toContainText('Unread');
    await expect(page.locator('.reader-main')).toHaveCount(0);
  });
  await check('right-click Open file location reveals the selected comic', async () => {
    await app.evaluate(({ shell, Menu }) => {
      globalThis.revealedFiles = []; shell.showItemInFolder = file => globalThis.revealedFiles.push(file);
      Menu.prototype.popup = function () { globalThis.contextLabels = this.items.map(item => item.label); this.items[0].click(); };
    });
    await page.locator('.book-card').filter({ hasText: 'Issue 01' }).click({ button: 'right' });
    await expect.poll(() => app.evaluate(() => globalThis.revealedFiles)).toEqual([path.join(library, 'Issue 01.cbz')]);
    expect(await app.evaluate(() => globalThis.contextLabels)).toEqual(['Open file location']);
  });
  await check('favorite card and shortcut populate Favorites and survive rescan', async () => {
    await issues();
    await page.getByRole('button', { name: 'Add to favorites: Issue 01', exact: true }).click();
    await favorites().click(); await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(page.locator('.book-card')).toContainText('Issue 01');
    await page.keyboard.press('F5'); await expect(favorites()).toContainText('1');
    await page.locator('.book-card').focus(); await page.keyboard.press('Control+d');
    await expect(page.locator('.book-card')).toHaveCount(0);
    await issues();
    await page.locator('.book-card').filter({ hasText: 'Issue 01' }).click();
    await expect(page.locator('.page-count')).toContainText('Page 1');
    await page.keyboard.press('Control+d');
    await expect(page.getByRole('button', { name: 'Toggle favorite comic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
  await check('saving without a folder opens preferences; chosen destination and shortcuts persist', async () => {
    await page.keyboard.press('Control+Shift+s');
    await expect(page.getByRole('dialog', { name: 'Preferences', exact: true })).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, saved);
    await page.getByRole('button', { name: 'Choose saved pages folder', exact: true }).click();
    await expect(page.locator('.saved-pages-path')).toHaveText(saved);
    await page.screenshot({ path: 'validation/ui-saved-pages-preferences.png' });
    await page.getByRole('button', { name: 'Shortcuts', exact: true }).click();
    await page.getByRole('button', { name: 'Shortcut for Save original page', exact: true }).click(); await page.keyboard.press('Control+Alt+s');
    await page.getByRole('button', { name: 'Shortcut for Toggle favorite comic', exact: true }).click(); await page.keyboard.press('F9');
    await page.getByRole('button', { name: 'Done', exact: true }).click();
  });
  await check('CBZ exports exact original JPEG bytes and repeated save creates no duplicate', async () => {
    await page.keyboard.press('Control+Alt+s'); await expect(page.locator('.toast')).toContainText('Page saved:');
    expect((await fs.readFile(path.join(saved, 'Issue 01/008.JPG'))).equals(bytes)).toBe(true);
    await page.keyboard.press('Control+Alt+s'); await expect(page.locator('.toast')).toContainText('Already saved:');
    expect(await fs.readdir(path.join(saved, 'Issue 01'))).toEqual(['008.JPG']);
    await goTo(2); await page.getByRole('button', { name: 'Save original page', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('016.JPG');
    expect((await fs.readFile(path.join(saved, 'Issue 01/016.JPG'))).equals(bytes)).toBe(true);
  });
  await check('saving a page confirms its destination in clean fullscreen', async () => {
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('F11');
    await expect(page.locator('.reader-toolbar')).toHaveCount(0);
    await page.keyboard.press('Control+Alt+s'); await expect(page.locator('.toast')).toBeVisible(); await expect(page.locator('.toast')).toContainText(saved);
    await page.locator('.saved-location').click();
    await expect.poll(() => app.evaluate(() => globalThis.revealedFiles.at(-1))).toBe(path.join(saved, 'Issue 01/016.JPG'));
    await page.screenshot({ path: 'validation/ui-fullscreen-save.png' });
    await expect(page.locator('.reader-footer')).toHaveCount(0); await page.keyboard.press('F11');
  });
  await check('continuous reading saves the page at the viewport position', async () => {
    await goTo(1); await page.keyboard.press('t');
    await expect(page.locator('.webtoon-page[data-page="0"] img')).toHaveCount(1);
    await expect(page.locator('.webtoon-page[data-page="1"] img')).toHaveCount(1);
    await page.locator('.reading-viewport').evaluate(v => { v.scrollTop = v.querySelector('[data-page="1"]').offsetTop + 100; });
    await expect(page.locator('.page-count')).toContainText('Page 2');
    await page.keyboard.press('Control+Alt+s'); await expect(page.locator('.toast')).toContainText('016.JPG');
    await page.keyboard.press('t');
  });
  await check('guided zoom remains stable through scrollbar thresholds and resizing', async () => {
    const id = books.find(b => b.title === 'Issue 01').id;
    const panels = [{ x: 0, y: .1, w: 1, h: .12 }, { x: .2, y: 0, w: .2, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }].map(p => ({ ...p, polygon: [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]] }));
    await page.evaluate(async ({ id, panels }) => { await window.reader.savePanels(id, 1, panels); }, { id, panels });
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('p');
    await expect(page.locator('.page-count')).toContainText('Panel 1 / 3');
    for (const width of [1440, 1000, 760]) {
      await page.setViewportSize({ width, height: 900 });
      const toolbar = await page.locator('.reader-tools').boundingBox();
      expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(width);
      for (let i = 1; i <= 3; i++) {
        await expect(page.locator('.page-count')).toContainText(`Panel ${i} / 3`);
        await stablePanel(`${width}px panel ${i}`);
        if (i < 3) await page.keyboard.press('ArrowRight');
      }
      if (width !== 760) { await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); }
    }
    await page.keyboard.press('p'); await page.keyboard.press('w');
    await expect.poll(() => page.locator('.reading-viewport').evaluate(v => v.scrollTop)).toBe(0);
    await page.setViewportSize({ width: 1440, height: 950 });
  });
  await check('tiled webtoon export retains the complete original PNG', async () => {
    await page.keyboard.press('l'); await issues();
    await page.locator('.book-card').filter({ hasText: 'Tall image' }).click();
    await expect(page.locator('.reading-viewport')).toHaveClass(/webtoon/);
    await page.keyboard.press('Control+Alt+s'); await expect(page.locator('.toast')).toContainText('Tall image.png');
    expect((await fs.readFile(path.join(saved, 'Tall image/Tall image.png'))).equals(longBytes)).toBe(true);
  });
  if (process.env.PANEL_READER_JITTER_SAMPLE) await check('omnibus pages 8, 16, and 82 stay stable on every detected panel; CBR/CBZ exports match originals', async () => {
    const file = path.resolve(process.env.PANEL_READER_JITTER_SAMPLE);
    const [book] = await page.evaluate(file => window.reader.addPaths([file]), file);
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file);
    await page.keyboard.press('Control+o'); await expect(page.locator('.reader-title strong')).toHaveText(book.title);
    await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('p');
    const archive = await openArchive(file);
    try {
      for (const number of [8, 16, 82]) {
        await goTo(number);
        const result = await page.evaluate(({ id, index }) => window.reader.panels(id, index), { id: book.id, index: number - 1 });
        for (let i = 1; i <= result.panels.length; i++) {
          await expect(page.locator('.page-count')).toContainText(`Panel ${i} / ${result.panels.length}`);
          await stablePanel(`omnibus page ${number} panel ${i}`);
          if (i < result.panels.length) await page.keyboard.press('ArrowRight');
        }
        const resultSave = await page.evaluate(({ id, index }) => window.reader.savePage(id, index), { id: book.id, index: number - 1 });
        expect((await fs.readFile(resultSave.path)).equals(await archive.read(number - 1))).toBe(true);
      }
    } finally { archive.close(); }
  });
  await check('favorites, destination and changed shortcuts survive app restart', async () => {
    await app.close(); app = await launch(); page = await app.firstWindow(); page.setDefaultTimeout(30000);
    await favorites().click(); await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(page.locator('.book-card')).toContainText('Issue 01');
    await page.screenshot({ path: 'validation/ui-favorites.png' });
    const state = await page.evaluate(() => window.reader.state());
    expect(state.settings.savePageFolder).toBe(saved);
    expect(state.settings.shortcuts.savePage).toBe('Ctrl+Alt+S'); expect(state.settings.shortcuts.favorite).toBe('F9');
    await page.locator('.book-card').focus(); await page.keyboard.press('F9'); await expect(page.locator('.book-card')).toHaveCount(0);
  });
  if (process.env.PANEL_READER_EXPORT_SAMPLE) await check('original CBR entry is exported without format conversion', async () => {
    const file = path.resolve(process.env.PANEL_READER_EXPORT_SAMPLE), archive = await openArchive(file);
    try {
      expect(archive.kind).toBe('rar');
      const [book] = await page.evaluate(file => window.reader.addPaths([file]), file);
      const result = await page.evaluate(id => window.reader.savePage(id, 0), book.id);
      expect((await fs.readFile(result.path)).equals(await archive.read(0))).toBe(true);
      expect(path.extname(result.path)).toBe(path.extname(archive.names[0]));
    } finally { archive.close(); }
  });
  expect(errors).toEqual([]);
} finally {
  await app.close(); await fs.writeFile('validation/feature-report.json', JSON.stringify({ checks, errors, panelChecks }, null, 2));
}
