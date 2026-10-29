import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import yazl from 'yazl';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { scanFolders } from '../core/library.mjs';
import { DEFAULT_SETTINGS } from '../core/settings.mjs';
import { createHash } from 'node:crypto';
import { ReadingProgress } from '../core/reading-progress.mjs';
await fs.mkdir('validation', { recursive: true });
const root = await fs.mkdtemp(path.resolve('validation/network-')), library = path.join(root, 'Existing'), network = path.join(root, 'Network'), slow = path.join(network, 'Slow'), data = path.join(root, 'data');
for (const dir of [library, slow, data]) await fs.mkdir(dir, { recursive: true });
const bytes = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#416b82' } }).png().toBuffer();
async function comic(file, label) { const zip = new yazl.ZipFile(), stream = createWriteStream(file); zip.outputStream.pipe(stream); zip.addBuffer(bytes, '1.png'); zip.addBuffer(bytes, '2.png'); zip.addBuffer(Buffer.from(label), 'ComicInfo.xml'); zip.end(); await finished(stream); }
await comic(path.join(library, 'Existing issue.cbz'), 'existing'); await comic(path.join(network, 'Ready issue.cbz'), 'ready'); await comic(path.join(slow, 'Later issue.cbz'), 'later');
const { books } = await scanFolders([library]);
const oldStat = await fs.stat(books[0].path), legacyId = 'sha256:' + createHash('sha256').update(await fs.readFile(books[0].path)).digest('hex');
const legacy = new ReadingProgress({ localFile: path.join(data, 'reading-progress.json') }); await legacy.init();
const legacyRecord = await legacy.record(legacyId, { progress: { page: 0, panel: 0, offset: 0, mode: 'page' }, completed: false, pageCount: 2, at: 100 });
Object.assign(books[0], { contentId: legacyId, progressSeeded: legacyId, fingerprintStamp: `${oldStat.size}:${oldStat.mtimeMs}:${oldStat.ctimeMs}`, progress: legacyRecord.progress, pageCount: 2, lastRead: 100, isNew: false });
await fs.writeFile(path.join(data, 'library.json'), JSON.stringify({ folders: [library], books, settings: { ...DEFAULT_SETTINGS, autoScanMinutes: 0 } }));
const env = { ...process.env, PANEL_READER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ ...(process.env.PANEL_READER_EXE ? { executablePath: process.env.PANEL_READER_EXE, args: [] } : { args: ['.'] }), env, timeout: 60000 }), page = await app.firstWindow();
const errors = [], checks = []; page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS:', name); };
try {
  await expect(page.locator('.library-footer')).toBeVisible();
  await check('upgrading a known archive retains its old bookmark and causal history', async () => {
    await expect.poll(async () => (await page.evaluate(() => window.reader.state())).books[0].fingerprintVersion).toBe(2);
    const book = (await page.evaluate(() => window.reader.state())).books[0]; expect(book.contentId).not.toBe(legacyId);
    expect(book.progress.page).toBe(0); expect(book.lastRead).toBe(100);
    const document = JSON.parse(await fs.readFile(path.join(data, 'reading-progress.json'), 'utf8'));
    expect(document.entries[book.contentId][0].id).toBe(legacyRecord.event.id); expect(document.entries[legacyId][0].id).toBe(legacyRecord.event.id);
  });
  await check('the library has no slogans or idle file-type advertising', async () => {
    await expect(page.locator('body')).not.toContainText('Local. Offline. Yours.'); await expect(page.locator('body')).not.toContainText('Made for the art');
    await expect(page.locator('.format-tags')).toHaveCount(0);
    await page.getByLabel('Search comics').fill('Existing');
    await expect(page.locator('.book-meta')).not.toContainText(/CBZ|CBR|JPG|PNG/);
    await page.getByLabel('Search comics').fill('');
  });
  await check('discovered comics appear while another folder is still waiting on the network', async () => {
    await app.evaluate(({ dialog }, { network, slow }) => {
      const io = process.getBuiltinModule('fs/promises'), original = io.readdir;
      let release; const gate = new Promise(resolve => { release = resolve; });
      globalThis.releaseNetworkTest = () => { io.readdir = original; release(); };
      io.readdir = async (folder, options) => { if (folder === slow) await gate; return original(folder, options); };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [network] });
    }, { network, slow });
    await page.getByRole('button', { name: 'Add library folder', exact: true }).last().click();
    await expect(page.getByRole('progressbar', { name: 'Library scan progress' })).toBeVisible();
    await page.getByLabel('Search comics').fill('Ready'); await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Cancel scan', exact: true })).toBeVisible();
    await page.screenshot({ path: 'validation/ui-network-scan.png' });
  });
  await check('an available comic opens and reads before a stalled scan completes', async () => {
    await page.locator('.book-card').click(); await expect(page.locator('.reader-title strong')).toHaveText('Ready issue');
    await expect(page.locator('.page-art img')).toBeVisible(); await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('ArrowRight');
    await expect(page.locator('.page-count')).toContainText('Page 2');
    expect((await page.evaluate(() => window.reader.state())).scanStatus.active).toBe(true);
    await page.keyboard.press('l'); await expect(page.getByRole('button', { name: 'Cancel scan', exact: true })).toBeVisible();
  });
  await check('Cancel scan responds without waiting for the stalled network folder', async () => {
    await page.getByRole('button', { name: 'Cancel scan', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Library scan progress' })).toHaveCount(0);
    const state = await page.evaluate(() => window.reader.state()); expect(state.scanStatus.cancelled).toBe(true);
    expect(state.books.some(book => book.title === 'Ready issue')).toBe(true); expect(state.books.some(book => book.title === 'Existing issue' && !book.missing)).toBe(true);
    await app.evaluate(() => globalThis.releaseNetworkTest());
    await page.getByLabel('Search comics').fill('Later'); await expect(page.locator('.book-card')).toHaveCount(0);
  });
  await check('a later rescan can finish normally and discover the remaining issue', async () => {
    await page.getByRole('button', { name: 'Rescan folders', exact: true }).click(); await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(page.locator('.scan-progress')).toHaveCount(0);
  });
  expect(errors).toEqual([]); await fs.writeFile('validation/network-report.json', JSON.stringify({ checks, errors }, null, 2));
} finally { await app.evaluate(() => globalThis.releaseNetworkTest?.()).catch(() => {}); await app.close(); }
console.log(`Passed ${checks.length} network desktop checks.`);
