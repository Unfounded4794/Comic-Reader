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
  await check('the library has no slogans and shows each comic format', async () => {
    await expect(page.locator('body')).not.toContainText('Local. Offline. Yours.'); await expect(page.locator('body')).not.toContainText('Made for the art');
    await expect(page.locator('.format-tags')).toHaveCount(0);
    await page.getByLabel('Search comics').fill('Existing');
    await expect(page.locator('.book-meta')).toContainText('CBZ');
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
  await check('a failed network scan preserves comics and reopening works after reconnect', async () => {
    const file = path.join(slow, 'Later issue.cbz'), detached = `${file}.offline`;
    await app.evaluate((_, network) => {
      const io = process.getBuiltinModule('fs/promises'), original = io.readdir;
      globalThis.releaseNetworkTest = () => { io.readdir = original; };
      io.readdir = async (folder, options) => {
        if (folder === network) throw Object.assign(new Error('EIO: simulated disconnected share'), { code: 'EIO' });
        return original(folder, options);
      };
    }, network);
    await fs.rename(file, detached);
    try {
      await page.getByRole('button', { name: 'Rescan folders', exact: true }).click();
      await expect(page.locator('.scan-warning')).toContainText('simulated disconnected share');
      const state = await page.evaluate(() => window.reader.state());
      expect(state.books.filter(book => book.root === network).map(book => book.missing)).toEqual([false, false]);
      await page.locator('.book-card').click();
      await expect(page.locator('.toast')).toContainText('Could not open “Later issue”');
      await expect(page.locator('.book-card')).not.toHaveClass(/missing/);
    } finally {
      await fs.rename(detached, file);
      await app.evaluate(() => globalThis.releaseNetworkTest());
    }
    await page.getByRole('button', { name: 'Retry scan', exact: true }).click();
    await expect(page.locator('.scan-warning')).toHaveCount(0);
    await page.locator('.book-card').click();
    await expect(page.locator('.reader-title strong')).toHaveText('Later issue');
    await expect(page.locator('.page-count')).toContainText('Page 1 / 2');
    await expect(page.locator('.page-art img')).toBeVisible();
  });
  if (process.platform === 'linux') await check('an expired KDE SMB mount reconnects without re-adding comics or the progress folder', async () => {
    const runtime = path.join(root, 'runtime'), tools = path.join(root, 'tools');
    const before = path.join(runtime, 'kio-fuse-Test1', 'smb', 'server.local', 'Comic Library');
    const after = path.join(runtime, 'kio-fuse-Test2', 'smb', 'server.local', 'Comic Library');
    for (const folder of [before, path.dirname(after), tools]) await fs.mkdir(folder, { recursive: true });
    await comic(path.join(before, 'KDE issue.cbz'), 'kde');
    await fs.writeFile(path.join(tools, 'dbus-send'), `#!/bin/sh
[ "$7" = org.kde.KIOFuse.VFS.mountUrl ] || exit 1
[ "$8" = string:smb://server.local/Comic%20Library ] || exit 1
printf 'method return\n   string "%s"\n' "$PANEL_READER_TEST_KDE_PATH"
`, { mode: 0o755 });
    await page.keyboard.press('l');
    await app.evaluate(({ dialog }, { runtime, tools, before, after }) => {
      process.env.XDG_RUNTIME_DIR = runtime;
      process.env.PATH = `${tools}:${process.env.PATH}`;
      process.env.PANEL_READER_TEST_KDE_PATH = after;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [before] });
    }, { runtime, tools, before, after });
    await page.getByRole('button', { name: 'Add library folder', exact: true }).last().click();
    await page.getByLabel('Search comics').fill('KDE issue');
    const tile = page.locator('.book-tile').filter({ hasText: 'KDE issue' });
    await expect(tile).toHaveCount(1);
    await expect(page.locator('.scan-progress')).toHaveCount(0);
    const id = await tile.getAttribute('data-book-id');
    await page.evaluate(async folder => {
      const { settings } = await window.reader.state();
      await window.reader.settings({ ...settings, progressFolder: folder });
    }, before);
    await fs.rename(before, after);
    await tile.locator('.book-card').click();
    await expect(page.locator('.reader-title strong')).toHaveText('KDE issue');
    await expect(page.locator('.page-art img')).toBeVisible();
    const status = await page.evaluate(() => window.reader.syncProgress());
    expect(status.state).toBe('synced');
    expect((await fs.readdir(path.join(after, '.panel-reader-progress'))).some(name => name.endsWith('.json'))).toBe(true);
    await page.keyboard.press('l');
    await expect(tile).toHaveAttribute('data-book-id', id);
    await expect(tile.locator('.book-card')).not.toHaveClass(/missing/);
  });
  expect(errors).toEqual([]); await fs.writeFile('validation/network-report.json', JSON.stringify({ checks, errors }, null, 2));
} finally { await app.evaluate(() => globalThis.releaseNetworkTest?.()).catch(() => {}); await app.close(); }
console.log(`Passed ${checks.length} network desktop checks.`);
