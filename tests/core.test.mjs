import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { finished } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import yazl from 'yazl';
import { openArchive, isImage, naturalCompare } from '../core/archive.mjs';
import { scanFolders } from '../core/library.mjs';
import { booksInFolder, directBooksInFolder, findFolderNode, folderTree, readingHistory, seriesContinuations } from '../core/catalog.mjs';
import { DEFAULT_SETTINGS, ACTIONS, normalizeSettings, keyChord } from '../core/settings.mjs';
import { suppressDuplicates, validatePanels, orderFeatures } from '../core/panels.mjs';
async function temporary(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-reader-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
test('CBZ reads actual entries in natural order, skipping metadata; disguised extensions work', async t => {
  const dir = await temporary(t), file = path.join(dir, 'issue.cbr'), zip = new yazl.ZipFile();
  const output = createWriteStream(file); zip.outputStream.pipe(output);
  for (const name of ['pages/10.jpg', 'pages/2.jpg', '__MACOSX/._01.jpg', 'ComicInfo.xml', 'pages/01.jpg']) zip.addBuffer(Buffer.from(name), name);
  zip.end(); await finished(output);
  const archive = await openArchive(file); t.after(() => archive.close());
  assert.equal(archive.kind, 'zip'); assert.deepEqual(archive.names, ['pages/01.jpg', 'pages/2.jpg', 'pages/10.jpg']);
  assert.equal((await archive.read(1)).toString(), 'pages/2.jpg');
  assert.throws(() => archive.read(50), /Page does not exist/);
});
test('standalone JPG and PNG files open as one-page books', async t => {
  const dir = await temporary(t);
  for (const name of ['long-webtoon.jpg', 'page.png']) {
    const file = path.join(dir, name), bytes = Buffer.from(`image:${name}`); await fs.writeFile(file, bytes);
    const image = await openArchive(file); assert.equal(image.kind, 'image'); assert.deepEqual(image.names, [name]); assert.deepEqual(await image.read(0), bytes); assert.throws(() => image.read(1), /Page does not exist/);
  }
});
test('folder rescans discover nested additions once, retain progress, and mark missing files', async t => {
  const dir = await temporary(t); await fs.mkdir(path.join(dir, 'nested'));
  await fs.writeFile(path.join(dir, 'Issue 1.cbz'), 'one');
  const first = await scanFolders([dir]); assert.equal(first.added, 1);
  first.books[0].progress = { page: 5, panel: 2 }; first.books[0].isNew = false;
  await fs.writeFile(path.join(dir, 'nested', 'Issue 2.CBR'), 'two');
  const second = await scanFolders([dir, path.join(dir, 'nested')], first.books);
  assert.equal(second.added, 1); assert.equal(second.books.length, 2); assert.deepEqual(second.books[0].progress, { page: 5, panel: 2 }); assert.equal(second.books[0].isNew, false);
  await fs.unlink(path.join(dir, 'Issue 1.cbz'));
  const third = await scanFolders([dir], second.books); assert.equal(third.added, 0); assert.equal(third.books[0].missing, true);
});
test('deep folder scans preserve the hierarchy and assign overlapping roots once', async t => {
  const dir = await temporary(t), series = path.join(dir, 'DC', 'Batman', '2023');
  await fs.mkdir(series, { recursive: true });
  await fs.writeFile(path.join(series, 'Batman 035.cbz'), 'thirty-five');
  await fs.writeFile(path.join(series, 'Batman 036.cbr'), 'thirty-six');
  const result = await scanFolders([dir, path.join(dir, 'DC')]);
  assert.equal(result.books.length, 2);
  assert.ok(result.books.every(book => book.root === path.join(dir, 'DC')));
  assert.ok(result.books.every(book => book.relativeDir.replaceAll('\\', '/') === 'Batman/2023'));
  const tree = folderTree([path.join(dir, 'DC')], result.books);
  assert.equal(tree[0].count, 2); assert.equal(tree[0].children[0].name, 'Batman'); assert.equal(tree[0].children[0].children[0].name, '2023');
  assert.equal(booksInFolder(result.books, { root: path.join(dir, 'DC'), relative: 'Batman' }).length, 2);
  assert.equal(directBooksInFolder(result.books, { root: path.join(dir, 'DC'), relative: 'Batman' }).length, 0);
  assert.equal(directBooksInFolder(result.books, { root: path.join(dir, 'DC'), relative: 'Batman/2023' }).length, 2);
  assert.equal(findFolderNode(tree, { root: path.join(dir, 'DC'), relative: 'Batman/2023' }).count, 2);
});
test('history and up-next queues follow natural issue order within each folder', () => {
  const books = [
    { id: '35', title: 'Batman 035', folder: 'P:/DC/Batman', lastRead: 100 },
    { id: '36', title: 'Batman 036', folder: 'P:/DC/Batman' },
    { id: '1', title: 'Impulse 01', folder: 'P:/DC/Impulse', lastRead: 200 },
    { id: '2', title: 'Impulse 02', folder: 'P:/DC/Impulse' },
  ];
  assert.deepEqual(readingHistory(books).map(book => book.id), ['1', '35']);
  assert.deepEqual(seriesContinuations(books).map(item => item.next.id), ['2', '36']);
});
test('shortcuts are unique, fully configurable, and use layout-independent key codes', () => {
  assert.equal(new Set(ACTIONS.map(a => a[2])).size, ACTIONS.length);
  assert.equal(keyChord({ code: 'KeyJ', key: 'j', ctrlKey: true }), 'Ctrl+J');
  const config = normalizeSettings({ shortcuts: { next: 'J', scrollDown: 'K' }, scrollAmount: -50, background: 'bad', detectionThreshold: 8 });
  assert.equal(config.shortcuts.next, 'J'); assert.equal(config.shortcuts.scrollDown, 'K'); assert.equal(config.scrollAmount, 10); assert.equal(config.background, DEFAULT_SETTINGS.background); assert.equal(config.detectionThreshold, .9);
});
test('duplicate suppression preserves inset panels and rejects duplicate detections', () => {
  const parent = { x: .05, y: .05, w: .9, h: .8, confidence: .9 };
  const inset = { x: .6, y: .5, w: .25, h: .25, confidence: .8 };
  const results = suppressDuplicates([parent, inset, { ...inset, x: .601, confidence: .7 }]);
  assert.equal(results.length, 2); assert.ok(results.includes(inset));
});
test('manual polygons retain concavity and validate coordinates', () => {
  const polygon = [[0,0],[.8,.1],[.9,.7],[.4,.5],[.1,.9]];
  const result = validatePanels([{ polygon }]); assert.deepEqual(result[0].polygon, polygon); assert.equal(result[0].w, .9); assert.equal(result[0].source, 'manual');
  assert.throws(() => validatePanels([{ polygon: [[0,0],[NaN,1],[1,1]] }]), /Invalid panel point/);
  assert.throws(() => validatePanels([]), /between 1 and 100/);
});
test('reading-order feature contract matches the trained model', () => {
  const a = { x: 0, y: 0, w: .4, h: .3 }, b = { x: .5, y: 0, w: .4, h: .3 };
  const row = orderFeatures(a, b, .3, 2);
  assert.equal(row.length, 14); assert.ok(Math.abs(row[0] - .5) < 1e-7); assert.equal(row[2], 1); assert.equal(row[3], 0); assert.equal(row[13], 1);
});
test('image filenames ignore OS metadata and sort numeric chapters', () => {
  assert.equal(isImage('__MACOSX/cover.jpg'), false); assert.equal(isImage('.hidden/cover.png'), false); assert.equal(isImage('chapter/001.webp'), true);
  assert.deepEqual(['10.jpg', '2.jpg', '1.jpg'].sort(naturalCompare), ['1.jpg','2.jpg','10.jpg']);
});
