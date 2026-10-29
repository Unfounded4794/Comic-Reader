import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { scanFolders } from '../core/library.mjs';
import { DEFAULT_SETTINGS } from '../core/settings.mjs';

await fs.mkdir('validation', { recursive: true });
const root = await fs.mkdtemp(path.resolve('validation/progress-'));
const shared = path.join(root, 'Network drive'), local = path.join(root, 'Local comics'), remote = path.join(shared, 'Different folders');
for (const folder of [shared, local, remote]) await fs.mkdir(folder, { recursive: true });
const image = await sharp({ create: { width: 600, height: 900, channels: 3, background: '#486b86' } }).png().toBuffer();
async function archive(file, label) {
  const zip = new yazl.ZipFile(), stream = createWriteStream(file); zip.outputStream.pipe(stream);
  for (let i = 1; i <= 4; i++) zip.addBuffer(image, `${i}.png`);
  zip.addBuffer(Buffer.from(label), 'ComicInfo.xml'); zip.end(); await finished(stream);
}
const fileA = path.join(local, 'Issue 01.cbz'), fileB = path.join(remote, 'Renamed volume.cbz');
await archive(fileA, 'one'); await fs.copyFile(fileA, fileB); await archive(path.join(local, 'Issue 02.cbz'), 'two');
const tall = path.join(local, 'Tall episode.png');
await sharp({ create: { width: 300, height: 12000, channels: 3, background: '#7b5c77' } }).png().toFile(tall);
const checks = [], errors = [], apps = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS:', name); };
async function launch(name, library) {
  const data = path.join(root, name); await fs.mkdir(data, { recursive: true });
  try { await fs.access(path.join(data, 'library.json')); }
  catch { const { books } = await scanFolders([library]); await fs.writeFile(path.join(data, 'library.json'), JSON.stringify({ folders: [library], books, settings: { ...DEFAULT_SETTINGS, autoScanMinutes: 0 } })); }
  const env = { ...process.env, PANEL_READER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ['.'], env, timeout: 60000 }); apps.push(app);
  const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('.library-footer')).toBeVisible();
  return { app, page, data };
}
const state = device => device.page.evaluate(() => window.reader.state());
async function book(device, title) { return (await state(device)).books.find(b => b.title === title && !b.missing); }
async function sync(...devices) { for (const device of devices) await device.page.evaluate(() => window.reader.syncProgress()); }
async function key(device, chord) { await device.page.evaluate(() => document.activeElement?.blur()); await device.page.keyboard.press(chord); }
async function library(device) {
  if (await device.page.locator('.reader-toolbar').count()) await key(device, 'l');
  await expect(device.page.getByLabel('Search comics')).toBeVisible();
}
async function open(device, title, conflict = false) {
  await library(device); await device.page.getByLabel('Search comics').fill(title);
  await device.page.locator('.book-card').filter({ hasText: title }).first().click();
  if (conflict) await expect(device.page.getByRole('dialog', { name: 'Choose reading position', exact: true })).toBeVisible();
  else await expect(device.page.locator('.reader-title strong')).toHaveText(title);
}
async function go(device, page) {
  await key(device, 'g'); await device.page.getByLabel('Page number', { exact: true }).fill(String(page));
  await device.page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(device.page.locator('.page-count')).toContainText(`Page ${page}`);
}
async function sharing(device) {
  await key(device, 'Control+,');
  await device.page.getByRole('button', { name: 'Library', exact: true }).click();
  await device.app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, shared);
  await device.page.getByRole('button', { name: 'Choose shared folder', exact: true }).click();
  await expect(device.page.locator('.progress-setting .saved-pages-path')).toHaveText(shared);
  if (device === a) await device.page.screenshot({ path: 'validation/ui-progress-preferences.png' });
  await device.page.getByRole('button', { name: 'Done', exact: true }).click();
}
let a, b;
try {
  a = await launch('device-a', local); b = await launch('device-b', remote);
  await check('one folder choice enables sharing for local copies and shared-drive comics', async () => {
    await sharing(a); await sharing(b);
    await expect.poll(async () => (await book(a, 'Issue 01')).contentId).toBeTruthy();
    expect((await book(a, 'Issue 01')).contentId).toBe((await book(b, 'Renamed volume')).contentId);
  });
  await check('renamed copies resume across devices without matching directory structures', async () => {
    await open(a, 'Issue 01'); await go(a, 2);
    await expect.poll(async () => (await book(a, 'Issue 01')).progress?.page).toBe(1);
    await sync(a, b); await open(b, 'Renamed volume'); await expect(b.page.locator('.page-count')).toContainText('Page 2');
    await go(b, 3); await expect.poll(async () => (await book(b, 'Renamed volume')).progress?.page).toBe(2);
    await sync(b, a);
    await expect(a.page.locator('.sync-notice')).toBeVisible(); await expect(a.page.locator('.page-count')).toContainText('Page 2');
    await a.page.getByRole('button', { name: 'Use saved position', exact: true }).click();
    await expect(a.page.locator('.page-count')).toContainText('Page 3');
    expect((await book(a, 'Issue 01')).readingConflicts).toHaveLength(0);
  });
  await check('an idle reader closes without replacing the other device’s bookmark', async () => {
    const before = JSON.parse(await fs.readFile(path.join(a.data, 'reading-progress.json'), 'utf8')).sequence;
    await a.app.close(); await sync(b);
    expect((await book(b, 'Renamed volume')).progress.page).toBe(2);
    expect(JSON.parse(await fs.readFile(path.join(a.data, 'reading-progress.json'), 'utf8')).sequence).toBe(before);
    a = await launch('device-a', local);
  });
  await check('independent reading preserves both bookmarks and presents one choice', async () => {
    await open(a, 'Issue 01'); await expect(a.page.locator('.page-count')).toContainText('Page 3');
    // Both readers now have the same base. The active session remains at that
    // base even if a background exchange receives the other device's new event.
    await go(a, 1); await expect.poll(async () => (await book(a, 'Issue 01')).progress?.page).toBe(0);
    await go(b, 2); await expect.poll(async () => (await book(b, 'Renamed volume')).readingConflicts?.length).toBe(2);
    await sync(a, b, a);
    await library(a); await open(a, 'Issue 01', true);
    const dialog = a.page.getByRole('dialog', { name: 'Choose reading position', exact: true });
    await expect(dialog).toBeVisible(); await expect(dialog.locator('.progress-choices button')).toHaveCount(2);
    await a.page.screenshot({ path: 'validation/ui-progress-conflict.png' });
    await dialog.getByRole('button', { name: /^Page 2/ }).click();
    await expect(a.page.locator('.page-count')).toContainText('Page 2');
    await sync(a, b); expect((await book(b, 'Renamed volume')).readingConflicts).toHaveLength(0);
  });
  await check('completion changes covers and Continue reading automatically', async () => {
    await go(a, 4); await expect.poll(async () => (await book(a, 'Issue 01')).completed).toBe(true);
    await library(a); await a.page.getByLabel('Search comics').fill('Issue 01');
    const card = a.page.locator('.book-card').filter({ hasText: 'Issue 01' }); await expect(card).toHaveClass(/is-read/);
    await expect(card.locator('..').getByRole('button', { name: 'Mark unread: Issue 01', exact: true })).toBeVisible();
    expect(await card.locator('.cover>img').evaluate(el => getComputedStyle(el).filter)).toBe('grayscale(1)');
    await a.page.getByLabel('Search comics').fill('Issue');
    await a.page.screenshot({ path: 'validation/ui-reading-progress.png' });
    await a.page.getByLabel('Search comics').fill('');
    await expect(a.page.locator('.next-card').filter({ hasText: 'Issue 02' })).toHaveCount(1);
    await sync(a, b); expect((await book(b, 'Renamed volume')).completed).toBe(true);
  });
  await check('hovering the read badge offers Mark unread and Update progress shares the reset', async () => {
    await a.page.getByLabel('Search comics').fill('Issue 01');
    const badge = a.page.getByRole('button', { name: 'Mark unread: Issue 01', exact: true });
    await badge.hover(); await expect(badge.locator('.unread-label')).toBeVisible();
    await a.page.screenshot({ path: 'validation/ui-mark-unread.png' }); await badge.click();
    await expect.poll(async () => (await book(a, 'Issue 01')).completed).toBe(false);
    expect((await book(a, 'Issue 01')).progress).toBeUndefined(); expect((await book(a, 'Issue 01')).lastRead).toBeUndefined();
    await expect(a.page.locator('.book-card')).not.toHaveClass(/is-read/);
    await a.page.getByRole('button', { name: 'Update progress', exact: true }).click();
    await expect(a.page.locator('.toast')).toContainText('Reading progress is shared.');
    await library(b); await b.page.getByRole('button', { name: 'Update progress', exact: true }).click();
    await expect.poll(async () => (await book(b, 'Renamed volume')).progress).toBeUndefined();
    expect((await book(b, 'Renamed volume')).completed).toBe(false);
    await open(a, 'Issue 01'); await expect(a.page.locator('.page-count')).toContainText('Page 1');
    await go(a, 4); await expect.poll(async () => (await book(a, 'Issue 01')).completed).toBe(true);
    await sync(a, b); await library(a);
  });
  await check('guided completion waits for the final panel; reopening preserves it', async () => {
    const issue = await book(a, 'Issue 02');
    await a.page.evaluate(async id => window.reader.savePanels(id, 3, [{ polygon: [[0, 0], [1, 0], [1, .45], [0, .45]] }, { polygon: [[0, .5], [1, .5], [1, 1], [0, 1]] }]), issue.id);
    await open(a, 'Issue 02'); await key(a, 'p'); await go(a, 4);
    await expect(a.page.locator('.page-count')).toContainText('Panel 1 / 2');
    await expect.poll(async () => (await book(a, 'Issue 02')).progress?.page).toBe(3);
    expect((await book(a, 'Issue 02')).completed).toBe(false);
    await key(a, 'ArrowRight'); await expect.poll(async () => (await book(a, 'Issue 02')).completed).toBe(true);
    await go(a, 1); await library(a); await open(a, 'Issue 02');
    expect((await book(a, 'Issue 02')).completed).toBe(true);
    await key(a, 'p');
  });
  await check('a long webtoon stays unfinished until the viewport reaches the bottom', async () => {
    await open(a, 'Tall episode'); await expect(a.page.locator('.webtoon-stack')).toBeVisible();
    await expect.poll(async () => (await book(a, 'Tall episode')).progress?.page).toBe(0);
    expect((await book(a, 'Tall episode')).completed).toBe(false);
    await a.page.locator('.reading-viewport').evaluate(el => { el.scrollTop = el.scrollHeight; });
    await expect.poll(async () => (await book(a, 'Tall episode')).completed).toBe(true);
  });
  await check('missing network storage saves locally and retries after reconnect', async () => {
    await library(a); const value = await state(a);
    await a.page.evaluate(settings => window.reader.settings({ ...settings, progressFolder: settings.progressFolder + '-unavailable' }), value.settings);
    await open(a, 'Issue 01'); await go(a, 3);
    await expect.poll(async () => (await book(a, 'Issue 01')).progress?.page).toBe(2);
    await sync(a); expect((await state(a)).syncStatus.state).toBe('offline');
    await a.page.evaluate(settings => window.reader.settings(settings), value.settings);
    await sync(a, b); expect((await book(b, 'Renamed volume')).progress.page).toBe(2);
  });
  await check('file renaming and rescan preserve shared progress', async () => {
    await library(b); const renamed = path.join(remote, 'Moved and renamed again.cbz'); await fs.rename(fileB, renamed);
    await b.page.evaluate(() => window.reader.rescan());
    await expect.poll(async () => (await book(b, 'Moved and renamed again'))?.progress?.page).toBe(2);
    expect((await book(b, 'Moved and renamed again')).completed).toBe(true);
  });
  await check('replacing an archive at the same path starts a new history', async () => {
    await library(a); const original = (await book(a, 'Issue 01')).contentId;
    await archive(fileA, 'a different edition'); await a.page.evaluate(() => window.reader.rescan());
    await expect.poll(async () => (await book(a, 'Issue 01')).contentId).not.toBe(original);
    const replaced = await book(a, 'Issue 01'); expect(replaced.progress).toBeUndefined(); expect(replaced.completed).toBe(false);
    expect((await book(b, 'Moved and renamed again')).completed).toBe(true);
  });
  await check('closing immediately after a page turn flushes the bookmark before exit', async () => {
    await open(a, 'Issue 01'); await go(a, 2); await a.app.close();
    a = await launch('device-a', local); await open(a, 'Issue 01');
    await expect(a.page.locator('.page-count')).toContainText('Page 2');
  });
  expect(errors).toEqual([]);
  await fs.writeFile('validation/progress-report.json', JSON.stringify({ checks, errors, root }, null, 2));
} finally {
  for (const app of apps) await app.close().catch(() => {});
}
console.log(`Passed ${checks.length} reading-progress desktop checks.`);
