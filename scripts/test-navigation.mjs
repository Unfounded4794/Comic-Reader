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
const root = await fs.mkdtemp(path.resolve('validation', 'navigation-'));
const library = path.join(root, 'Library'), leaf = path.join(root, 'Leaf series'), empty = path.join(root, 'Empty source'), data = path.join(root, 'data');
for (const dir of [library, leaf, empty, data]) await fs.mkdir(dir);
const image = await sharp(Buffer.from('<svg width="800" height="1200"><rect width="800" height="1200" fill="white"/><rect x="30" y="30" width="740" height="510" fill="#335977"/><rect x="30" y="580" width="740" height="590" fill="#774e50"/></svg>')).png().toBuffer();
async function archive(file) {
  const zip = new yazl.ZipFile(), output = createWriteStream(file); zip.outputStream.pipe(output);
  for (let i = 1; i <= 3; i++) zip.addBuffer(image, `${i}.png`);
  zip.end(); await finished(output);
}
for (let i = 1; i <= 12; i++) {
  const folder = path.join(library, `Series ${String(i).padStart(2, '0')}`); await fs.mkdir(folder);
  await archive(path.join(folder, 'Issue 14.cbz')); await archive(path.join(folder, 'Issue 15.cbz'));
}
await archive(path.join(library, 'Root issue.cbz')); await archive(path.join(leaf, 'Only issue.cbz'));
const folders = [library, leaf, empty], { books } = await scanFolders(folders);
let recency = 100;
for (const book of books.filter(book => book.title === 'Issue 14')) Object.assign(book, { lastRead: ++recency, pageCount: 3, progress: { page: 1, panel: 0, offset: 0 }, isNew: false });
await fs.writeFile(path.join(data, 'library.json'), JSON.stringify({ folders, books, settings: { ...DEFAULT_SETTINGS, autoNextComic: true }, lastBook: null }));
const env = { ...process.env, PANEL_READER_DATA: data }; delete env.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.PANEL_READER_EXE;
const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env, timeout: 60000 });
const page = await app.firstWindow(), checks = [], errors = [];
page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS:', name); };
const home = () => page.locator('.sidebar .nav-item').first();
async function goTo(number) {
  await page.keyboard.press('g'); await page.getByLabel('Page number', { exact: true }).fill(String(number));
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.locator('.page-count')).toContainText(`Page ${number}`);
}
try {
  await check('Home combines children and leaf/empty sources under its matching count', async () => {
    await expect(page.locator('.folder-card')).toHaveCount(14);
    await expect(page.locator('.book-card')).toHaveCount(1);
    await expect(home()).toHaveText('Home15');
    await expect(page.locator('.collection-tabs button').first()).toHaveText('Home 15');
    await expect(page.getByRole('heading', { name: 'Collections', exact: true })).toHaveCount(0);
    expect(await page.locator('.folder-browser').evaluate(el => Boolean(el.previousElementSibling?.matches('.library-controls')))).toBe(true);
    await expect(page.locator('.folder-card').filter({ hasText: 'Leaf series' })).toHaveCount(1);
    await expect(page.locator('.folder-card').filter({ hasText: 'Empty source' })).toHaveCount(1);
    await expect(page.locator('.next-card')).toHaveCount(10);
    await expect(page.locator('.sidebar .folder-row')).toHaveCount(3);
    await expect(page.locator('.library-title')).toHaveCount(0);
    await expect(page.getByText('A LITTLE SPACE FOR OTHER WORLDS', { exact: true })).toHaveCount(0);
  });
  for (const width of [1280, 1920, 1000]) await check(`arrows follow visible card rows/columns at ${width}px`, async () => {
    await page.setViewportSize({ width, height: 950 });
    await home().focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('.next-card').first()).toBeFocused();
    await page.locator('.folder-card').first().focus();
    await page.keyboard.press('ArrowRight'); await expect(page.locator('.folder-card').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(page.locator('.folder-card').first()).toBeFocused();
    const columns = await page.locator('.folder-card-grid').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    await page.keyboard.press('ArrowDown'); await expect(page.locator('.folder-card').nth(columns)).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(page.locator('.folder-card').first()).toBeFocused();
    await home().focus(); await page.keyboard.press('ArrowDown'); await expect(page.locator('.sidebar .nav-item').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp'); await expect(home()).toBeFocused();
  });
  await check('Home, search, and sort arrow focus can return to nearby content', async () => {
    const homeTab = page.locator('.collection-tabs button').first();
    await homeTab.focus(); await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.next-card').first()).toBeFocused();
    const search = page.getByLabel('Search comics'), sort = page.getByLabel('Sort comics');
    await search.focus(); await page.keyboard.press('ArrowRight'); await expect(sort).toBeFocused();
    await page.keyboard.press('ArrowLeft'); await expect(search).toBeFocused();
    await search.focus(); await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => document.activeElement?.matches('input[aria-label="Search comics"], select[aria-label="Sort comics"]'))).toBe(false);
    await sort.focus(); await page.keyboard.press('ArrowDown');
    expect(await page.evaluate(() => document.activeElement?.matches('input[aria-label="Search comics"], select[aria-label="Sort comics"]'))).toBe(false);
  });
  await page.setViewportSize({ width: 1600, height: 1100 });
  await home().click(); await page.locator('.library-content').evaluate(el => { el.scrollTop = 0; }); await page.screenshot({ path: 'validation/ui-home-updated.png' });
  await check('Enter opens a collection and its directly contained issues', async () => {
    await page.locator('.folder-card').first().focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.library-title h1')).toContainText('Series 01');
    await expect(page.locator('.book-card')).toHaveCount(2);
    await expect(page.locator('.folder-up')).toBeFocused();
  });
  await check('backward chapter transition opens the final page; forward transition starts page one', async () => {
    await page.locator('.book-card').filter({ hasText: 'Issue 15' }).click();
    await expect(page.locator('.page-count')).toContainText('Page 1');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 14');
    await expect(page.locator('.page-count')).toContainText('Page 3');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 15');
    await expect(page.locator('.page-count')).toContainText('Page 1');
  });
  await check('guided backward transition selects the previous issue’s last panel', async () => {
    // Save known layouts to test stepping independently from detector accuracy.
    const seriesBooks = books.filter(book => book.relativeDir === 'Series 01');
    await page.evaluate(async values => {
      for (const book of values) for (const page of [0, 2]) await window.reader.savePanels(book.id, page, [{ polygon: [[0, 0], [1, 0], [1, .45], [0, .45]] }, { polygon: [[0, .5], [1, .5], [1, 1], [0, 1]] }]);
    }, seriesBooks);
    await page.keyboard.press('p'); await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 14');
    await expect(page.locator('.page-count')).toContainText('Page 3 / 3');
    await expect(page.locator('.page-count')).toContainText('Panel 2 / 2');
    await page.keyboard.press('ArrowLeft'); await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 15');
    await expect(page.locator('.page-count')).toContainText('Page 1 / 3');
    await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
  });
  await check('disabled automatic transitions and series boundaries keep the current comic', async () => {
    await page.keyboard.press('Control+,');
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByLabel(/Continue between comics/).uncheck();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.keyboard.press('ArrowLeft'); await expect(page.getByRole('status')).toContainText('Beginning of this comic.');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 15');
    await page.keyboard.press('p'); await page.keyboard.press('Control+ArrowLeft');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 14');
    await goTo(1); await page.keyboard.press('Control+ArrowLeft');
    await expect(page.getByRole('status')).toContainText('first comic in this series');
    await expect(page.locator('.reader-title strong')).toHaveText('Issue 14');
  });
  await check('panel four survives view changes while returning to page view starts at the top', async () => {
    const current = books.find(book => book.relativeDir === 'Series 01' && book.title === 'Issue 14');
    await page.evaluate(async id => {
      await window.reader.savePanels(id, 1, Array.from({ length: 4 }, (_, i) => ({ polygon: [[0, i / 4], [1, i / 4], [1, (i + 1) / 4], [0, (i + 1) / 4]] })));
    }, current.id);
    await goTo(2); await page.keyboard.press('p');
    await expect(page.locator('.page-count')).toContainText('Panel 1 / 4');
    for (let n = 2; n <= 4; n++) { await page.keyboard.press('ArrowRight'); await expect(page.locator('.page-count')).toContainText(`Panel ${n} / 4`); }
    for (const fit of ['w', 'h']) {
      await page.keyboard.press('p'); await page.keyboard.press(fit);
      await expect(page.locator('.reader-title span')).toContainText('Page view');
      await expect.poll(() => page.locator('.reading-viewport').evaluate(el => el.scrollTop)).toBe(0);
      await page.keyboard.press('p');
      await expect(page.locator('.page-count')).toContainText('Page 2 / 3');
      await expect(page.locator('.page-count')).toContainText('Panel 4 / 4');
    }
    await page.keyboard.press('p'); await page.keyboard.press('l');
    await page.locator('.book-card').filter({ hasText: 'Issue 14' }).click(); await page.keyboard.press('p');
    await expect(page.locator('.page-count')).toContainText('Panel 4 / 4');
    await page.keyboard.press('p'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('p');
    await expect(page.locator('.page-count')).toContainText('Page 3 / 3');
    await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
    await page.keyboard.press('p');
  });
  await check('guided view always contains wide and tall panels and ignores page fit shortcuts', async () => {
    const current = books.find(book => book.relativeDir === 'Series 01' && book.title === 'Issue 14');
    const knownPanels = [
      { polygon: [[.05, .06], [.95, .06], [.95, .19], [.05, .19]] },
      { polygon: [[.08, .22], [.25, .22], [.25, .96], [.08, .96]] },
    ];
    await page.evaluate(async ({ id, layout }) => window.reader.savePanels(id, 1, layout), { id: current.id, layout: knownPanels });
    await goTo(2); await page.keyboard.press('w'); await page.keyboard.press('p');
    await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
    await expect(page.locator('.segmented button:disabled')).toHaveCount(3);
    const expectContained = async active => {
      const bounds = await page.evaluate(({ panel }) => {
        const viewport = document.querySelector('.reading-viewport').getBoundingClientRect();
        const art = document.querySelector('.page-art').getBoundingClientRect();
        return {
          viewport: { left: viewport.left, top: viewport.top, right: viewport.right, bottom: viewport.bottom },
          frame: {
            left: art.left + panel.x * art.width, top: art.top + panel.y * art.height,
            right: art.left + (panel.x + panel.w) * art.width, bottom: art.top + (panel.y + panel.h) * art.height,
          },
        };
      }, { panel: active });
      expect(bounds.frame.left).toBeGreaterThanOrEqual(bounds.viewport.left - 2);
      expect(bounds.frame.top).toBeGreaterThanOrEqual(bounds.viewport.top - 2);
      expect(bounds.frame.right).toBeLessThanOrEqual(bounds.viewport.right + 2);
      expect(bounds.frame.bottom).toBeLessThanOrEqual(bounds.viewport.bottom + 2);
    };
    await expectContained({ x: .05, y: .06, w: .9, h: .13 });
    await page.keyboard.press('h');
    expect((await page.evaluate(() => window.reader.state())).settings.fit).toBe('width');
    await page.keyboard.press('ArrowRight'); await expect(page.locator('.page-count')).toContainText('Panel 2 / 2');
    await expectContained({ x: .08, y: .22, w: .17, h: .74 });
    await page.keyboard.press('p');
    await expect(page.getByRole('button', { name: 'Fit width', exact: true })).toHaveClass(/active/);
  });
  await check('manga mode reverses panel and page turns and exposes matching footer controls', async () => {
    await page.keyboard.press('p'); await page.keyboard.press('ArrowLeft'); await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
    await page.getByRole('button', { name: 'Switch left-to-right / right-to-left', exact: true }).click();
    await expect(page.locator('.reader-title span')).toContainText('Manga');
    await expect(page.locator('.reader-status')).toContainText('Your panel layout');
    await expect(page.locator('.page-navigation button').first()).toHaveAttribute('aria-label', 'Next page / panel');
    await expect(page.locator('.page-navigation button').last()).toHaveAttribute('aria-label', 'Previous page / panel');
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowLeft'); await expect(page.locator('.page-count')).toContainText('Panel 2 / 2');
    await page.keyboard.press('ArrowRight'); await expect(page.locator('.page-count')).toContainText('Panel 1 / 2');
    await page.keyboard.press('p'); await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('ArrowLeft'); await expect(page.locator('.page-count')).toContainText('Page 3 / 3');
    await page.keyboard.press('ArrowRight'); await expect(page.locator('.page-count')).toContainText('Page 2 / 3');
    await page.getByRole('button', { name: 'Switch left-to-right / right-to-left', exact: true }).click();
    await expect(page.locator('.reader-title span')).not.toContainText('Manga');
  });
  await check('guided panels open near the current position in a continuous image', async () => {
    const current = books.find(book => book.relativeDir === 'Series 01' && book.title === 'Issue 14');
    await page.evaluate(async id => window.reader.savePanels(id, 1, Array.from({ length: 4 }, (_, i) => ({ polygon: [[0, i / 4], [1, i / 4], [1, (i + 1) / 4], [0, (i + 1) / 4]] }))), current.id);
    await page.keyboard.press('t');
    await expect(page.locator('.webtoon-page[data-page="1"] img')).toHaveCount(1);
    await page.locator('.reading-viewport').evaluate(el => {
      const image = el.querySelector('[data-page="1"]');
      el.scrollTop = image.offsetTop + image.offsetHeight * .6;
    });
    await expect(page.locator('.page-count')).toContainText('Page 2 / 3');
    await page.keyboard.press('p');
    await expect(page.locator('.page-count')).toContainText('Panel 3 / 4');
  });
  if (process.env.PANEL_READER_PANEL_SAMPLE) await check('real dialogue extending past an outline remains in the guided frame and reveal mask', async () => {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, process.env.PANEL_READER_PANEL_SAMPLE);
    await page.keyboard.press('Control+o'); await expect(page.locator('.reader-title strong')).toContainText('Haikyu');
    await goTo(33); await page.keyboard.press('p');
    await expect(page.locator('.reader-status')).toContainText(/panels detected/, { timeout: 60000 });
    const layout = await page.evaluate(async () => { const state = await window.reader.state(); return window.reader.panels(state.lastBook, 32); });
    const index = layout.panels.findIndex(p => p.protectedRegions?.some(r => r.x < Math.min(...p.polygon.map(point => point[0])) - .002 || r.y < Math.min(...p.polygon.map(point => point[1])) - .002 || r.x + r.w > Math.max(...p.polygon.map(point => point[0])) + .002 || r.y + r.h > Math.max(...p.polygon.map(point => point[1])) + .002));
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < index; i++) { await page.keyboard.press('ArrowRight'); await expect(page.locator('.page-count')).toContainText(`Panel ${i + 2} /`); }
    const active = layout.panels[index];
    for (const region of active.protectedRegions) {
      expect(region.x).toBeGreaterThanOrEqual(active.x - 1e-9); expect(region.y).toBeGreaterThanOrEqual(active.y - 1e-9);
      expect(region.x + region.w).toBeLessThanOrEqual(active.x + active.w + 1e-9); expect(region.y + region.h).toBeLessThanOrEqual(active.y + active.h + 1e-9);
    }
    await expect(page.locator('.panel-shade mask rect')).toHaveCount(active.protectedRegions.length + 1);
    await page.screenshot({ path: 'validation/ui-dialogue-protection.png' });
    await goTo(10); await expect(page.locator('.reader-status')).toContainText(/panels detected/, { timeout: 60000 });
    const ltr = await page.evaluate(async () => { const state = await window.reader.state(); return window.reader.panels(state.lastBook, 9); });
    await page.getByRole('button', { name: 'Switch left-to-right / right-to-left', exact: true }).click();
    await expect(page.locator('.reader-title span')).toContainText('Manga');
    await expect.poll(async () => page.evaluate(async () => { const state = await window.reader.state(); return (await window.reader.panels(state.lastBook, 9)).optionsKey; }), { timeout: 60000 }).toContain(':rtl');
    const rtl = await page.evaluate(async () => { const state = await window.reader.state(); return window.reader.panels(state.lastBook, 9); });
    const signature = panel => [panel.x, panel.y, panel.w, panel.h].map(value => value.toFixed(4)).join(':');
    const ltrOrder = ltr.panels.map(signature), rtlOrder = rtl.panels.map(signature);
    const horizontalPairReversed = ltr.panels.some((first, i) => ltr.panels.some((second, j) => {
      if (i >= j || Math.min(first.y + first.h, second.y + second.h) - Math.max(first.y, second.y) < Math.min(first.h, second.h) * .35) return false;
      if (Math.abs(first.x + first.w / 2 - second.x - second.w / 2) < .08) return false;
      return rtlOrder.indexOf(ltrOrder[i]) > rtlOrder.indexOf(ltrOrder[j]);
    }));
    expect(horizontalPairReversed).toBe(true);
    await page.getByRole('button', { name: 'Switch left-to-right / right-to-left', exact: true }).click();
  });
  expect(errors).toEqual([]);
} catch (error) {
  errors.push(error.stack); console.error(error); process.exitCode = 1;
  await page.screenshot({ path: 'validation/ui-navigation-failure.png' }).catch(() => {});
} finally {
  await app.close(); await fs.writeFile(executablePath ? 'validation/packaged-navigation-report.json' : 'validation/navigation-report.json', JSON.stringify({ executablePath, checks, errors, root }, null, 2));
}
