import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriteStream } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { Worker } from 'node:worker_threads';
import yazl from 'yazl';
import sharp from 'sharp';
import { scanFolders } from '../core/library.mjs';
import { openArchive } from '../core/archive.mjs';
import { fingerprint } from '../core/reading-progress.mjs';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fixture(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-network-')); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function zip(file, bytes, count = 1) {
  const archive = new yazl.ZipFile(), output = createWriteStream(file); archive.outputStream.pipe(output);
  for (let i = 0; i < count; i++) archive.addBuffer(i === 0 ? bytes : Buffer.from(`page-${i}`), `${String(i).padStart(4, '0')}.png`, { compress: false });
  archive.end(); await finished(output);
}
test('ZIP identification reads directory blocks instead of multi-megabyte comic payloads', async t => {
  const root = await fixture(t), file = path.join(root, 'large.cbz'); await zip(file, randomBytes(8 * 1024 ** 2), 400);
  let reads = 0, bytesRead = 0;
  const book = await openArchive(file, { onRead: bytes => { reads++; bytesRead += bytes; } });
  assert.equal(book.names.length, 400); assert.ok(reads <= 6, `Directory requests: ${reads}`); assert.ok(bytesRead <= 192 * 1024, `Directory bytes: ${bytesRead}`);
  const id = book.contentId; book.close(); assert.equal((await fingerprint(file)).contentId, id);
});
test('old whole-file identifiers can migrate without discarding their identity', async t => {
  const root = await fixture(t), file = path.join(root, 'old.cbz'); await zip(file, Buffer.from('pages'));
  const stat = await fs.stat(file), old = { contentId: `sha256:${createHash('sha256').update(await fs.readFile(file)).digest('hex')}`, fingerprintStamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` };
  const next = await fingerprint(file, old);
  assert.notEqual(next.contentId, old.contentId); assert.equal(next.legacyContentId, old.contentId); assert.equal(next.fingerprintVersion, 2);
  assert.equal((await fingerprint(file, next)).contentId, next.contentId);
});

test('large ZIP page streams keep the archive open for subsequent and concurrent reads', async t => {
  const root = await fixture(t);
  for (const compress of [false, true]) {
    const file = path.join(root, `${compress}.cbz`), pages = Array.from({ length: 3 }, () => randomBytes(400000));
    const archive = new yazl.ZipFile(), output = createWriteStream(file); archive.outputStream.pipe(output);
    pages.forEach((bytes, i) => archive.addBuffer(bytes, `${i}.png`, { compress }));
    archive.end(); await finished(output);
    const book = await openArchive(file);
    try {
      assert.deepEqual(await book.read(0), pages[0]);
      // The old FileHandle stream had already destroyed the shared handle here.
      assert.deepEqual(await book.read(1), pages[1]);
      const results = await Promise.all([book.read(2), book.read(0), book.read(1)]);
      assert.deepEqual(results, [pages[2], pages[0], pages[1]]);
    } finally { book.close(); }
  }
});
test('discovery publishes usable batches while slower folders are still being scanned', async t => {
  const root = await fixture(t), slow = path.join(root, 'Slow'); await fs.mkdir(slow); await fs.writeFile(path.join(root, 'Ready.cbz'), 'ready');
  let release; const blocked = new Promise(resolve => { release = resolve; });
  let firstBatch; const published = new Promise(resolve => { firstBatch = resolve; }); let complete = false;
  const scan = scanFolders([root], [], { io: { ...fs, readdir: async (...args) => { if (args[0] === slow) await blocked; return fs.readdir(...args); } }, onBatch: books => firstBatch(books) }).then(value => { complete = true; return value; });
  const batch = await published; assert.equal(batch[0].title, 'Ready'); assert.equal(complete, false);
  release(); assert.equal((await scan).books.length, 1);
});
test('metadata requests use bounded concurrency rather than one network round trip at a time', async t => {
  const root = await fixture(t); for (let i = 0; i < 20; i++) await fs.writeFile(path.join(root, `${i}.cbz`), 'data');
  let active = 0, peak = 0;
  const io = { ...fs, stat: async (...args) => { active++; peak = Math.max(peak, active); await pause(5); try { return await fs.stat(...args); } finally { active--; } } };
  const result = await scanFolders([root], [], { io, concurrency: 4 }); assert.equal(result.books.length, 20); assert.equal(peak, 4);
});
test('cancel returns without waiting for a stalled network call and retains unvisited books', async t => {
  const root = await fixture(t); await fs.writeFile(path.join(root, 'Existing.cbz'), 'data'); const first = await scanFolders([root]);
  const controller = new AbortController(); let release; const pending = new Promise(resolve => { release = resolve; }); let batches = 0;
  const scan = scanFolders([root], first.books, { signal: controller.signal, io: { ...fs, readdir: async (...args) => { await pending; return fs.readdir(...args); } }, onBatch: () => batches++ });
  await pause(10); controller.abort();
  const result = await Promise.race([scan, pause(250).then(() => { throw new Error('Cancellation waited for network I/O.'); })]);
  assert.equal(result.cancelled, true); assert.equal(result.books[0].missing, false); release(); await pause(20); assert.equal(batches, 0);
});
test('cached covers and loaded pages survive a worker restart and an unavailable source', async t => {
  const root = await fixture(t), cache = path.join(root, 'cache'), file = path.join(root, 'cached.cbz');
  const image = await sharp({ create: { width: 100, height: 150, channels: 3, background: '#425e83' } }).png().toBuffer(); await zip(file, image);
  const stat = await fs.stat(file), source = { size: stat.size, modified: stat.mtimeMs, pageCount: 1 };
  const workers = [];
  const spawn = () => { const worker = new Worker(new URL('../electron/worker.mjs', import.meta.url), { workerData: { cache, models: path.resolve('models') } }); workers.push(worker); return worker; };
  t.after(async () => { for (const worker of workers) await worker.terminate(); });
  let id = 0;
  const rpc = (worker, method, args) => new Promise((resolve, reject) => {
    const serial = ++id;
    const receive = message => { if (message.id !== serial) return; worker.off('message', receive); message.error ? reject(new Error(message.error)) : resolve(message.result); };
    worker.on('message', receive); worker.postMessage({ id: serial, method, args });
  });
  const first = spawn(), cover = await rpc(first, 'image', { file, page: 0, source, thumbnail: true });
  await rpc(first, 'info', { file, page: 0, source }); await first.terminate(); await fs.rename(file, file + '.unavailable');
  const second = spawn();
  assert.deepEqual((await rpc(second, 'image', { file, page: 0, source, thumbnail: true })).bytes, cover.bytes);
  assert.deepEqual(Buffer.from((await rpc(second, 'image', { file, page: 0, source })).bytes), image);
  assert.equal((await rpc(second, 'info', { file, page: 0, source })).height, 150);
});

test('reader:info and page images keep working after reading a large compressed ZIP page', async t => {
  const root = await fixture(t), cache = path.join(root, 'cache'), file = path.join(root, 'large-pages.cbz');
  const bytes = await sharp(randomBytes(512 * 768 * 3), { raw: { width: 512, height: 768, channels: 3 } }).png().toBuffer();
  const archive = new yazl.ZipFile(), output = createWriteStream(file); archive.outputStream.pipe(output);
  for (let i = 0; i < 3; i++) archive.addBuffer(bytes, `${i}.png`);
  archive.end(); await finished(output);
  const worker = new Worker(new URL('../electron/worker.mjs', import.meta.url), { workerData: { cache, models: path.resolve('models') } });
  t.after(() => worker.terminate()); let id = 0;
  const rpc = (method, args) => new Promise((resolve, reject) => {
    const serial = ++id;
    const receive = message => { if (message.id !== serial) return; worker.off('message', receive); message.error ? reject(new Error(message.error)) : resolve(message.result); };
    worker.on('message', receive); worker.postMessage({ id: serial, method, args });
  });
  assert.equal((await rpc('open', { file })).names.length, 3);
  for (const page of [0, 1, 2, 0]) {
    assert.equal((await rpc('info', { file, page })).height, 768);
    assert.deepEqual(Buffer.from((await rpc('image', { file, page })).bytes), bytes);
  }
});
