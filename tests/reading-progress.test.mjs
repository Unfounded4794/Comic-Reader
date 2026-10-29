import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ReadingProgress, fingerprint, readingComplete } from '../core/reading-progress.mjs';
import { seriesContinuations } from '../core/catalog.mjs';

const key = `sha256:${'a'.repeat(64)}`;
const position = (page, mode = 'page') => ({ page, panel: 0, offset: 0, mode });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'panel-progress-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared'); await fs.mkdir(shared);
  const devices = [];
  async function device(name) {
    const statuses = [];
    const store = new ReadingProgress({ localFile: path.join(root, name, 'reading.json'), sharedFolder: () => shared, onStatus: value => statuses.push(value) });
    await store.init(); devices.push(store); store.statuses = statuses; return store;
  }
  return { root, shared, device };
}
const record = (store, page, clock = store.get(key).clock, completed = false, at = Date.now()) => store.record(key, { progress: position(page), pageCount: 50, clock, completed, at });

test('fingerprints follow renamed/copied bytes across unrelated folders and detect replacements', async t => {
  const { root } = await fixture(t), file = path.join(root, 'Issue 01.cbz'), renamed = path.join(root, 'A completely different name.cbr');
  await fs.writeFile(file, 'same comic bytes');
  const first = await fingerprint(file); await fs.copyFile(file, renamed);
  assert.equal((await fingerprint(renamed)).contentId, first.contentId);
  assert.equal((await fingerprint(file, first)).contentId, first.contentId);
  await fs.writeFile(renamed, 'other comic bytes');
  assert.notEqual((await fingerprint(renamed, first)).contentId, first.contentId);
});
test('image-folder identity ignores directory/page names while preserving reading order', async t => {
  const { root } = await fixture(t), a = path.join(root, 'a'), b = path.join(root, 'b');
  await fs.mkdir(a); await fs.mkdir(b);
  await fs.writeFile(path.join(a, '1.jpg'), 'first'); await fs.writeFile(path.join(a, '2.jpg'), 'second');
  await fs.writeFile(path.join(b, '01.png'), 'first'); await fs.writeFile(path.join(b, '02.png'), 'second');
  assert.equal((await fingerprint(a)).contentId, (await fingerprint(b)).contentId);
  const cached = await fingerprint(b); await fs.writeFile(path.join(b, '02.png'), 'updated');
  assert.notEqual((await fingerprint(b, cached)).contentId, cached.contentId);
});
test('normal cross-device handoffs use causal order even with incorrect wall clocks', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 10, {}, false, 999999); await a.sync(); await b.sync();
  await record(b, 20, b.get(key).clock, false, 100); await b.sync(); await a.sync();
  assert.equal(a.get(key).progress.page, 20); assert.equal(a.get(key).conflicts.length, 0);
  await a.sync(); await b.sync(); assert.equal(b.get(key).progress.page, 20);
});
test('offline branches survive restart, reconnect, repeated exchange and explicit resolution', async t => {
  const { root, device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 5); await a.sync(); await b.sync();
  const baseA = a.get(key).clock, baseB = b.get(key).clock;
  await record(a, 24, baseA); await record(b, 38, baseB);
  await b.sync(); await a.sync(); await b.sync();
  assert.deepEqual(a.get(key).heads.map(e => e.progress.page).sort((x, y) => x - y), [24, 38]);
  const restarted = await device('a');
  assert.equal(restarted.get(key).conflicts.length, 2);
  const selected = restarted.get(key).heads.find(e => e.progress.page === 24);
  await restarted.resolve(key, selected.id, restarted.get(key).revision);
  await restarted.sync(); await b.sync(); await a.sync(); await restarted.sync();
  assert.equal(b.get(key).progress.page, 24); assert.equal(b.get(key).conflicts.length, 0);
  assert.equal(restarted.get(key).heads.length, 1);
  assert.ok((await fs.readFile(path.join(root, 'a', 'reading.json'), 'utf8')).includes('"version":1'));
});
test('a stale active session does not silently acknowledge a received remote update', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 1); await a.sync(); await b.sync(); const activeSession = a.get(key).clock;
  await record(b, 30); await b.sync(); await a.sync();
  await record(a, 2, activeSession); await a.sync(); await b.sync();
  assert.equal(b.get(key).conflicts.length, 2);
});
test('delayed publishing of an idle snapshot cannot replace a later reading position', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 20); await a.sync(); await b.sync();
  await record(b, 30); await b.sync();
  // A sync is an exchange, never a new reading event.
  const oldSequence = a.document.sequence; await a.sync(); await b.sync();
  assert.equal(a.document.sequence, oldSequence); assert.equal(b.get(key).progress.page, 30);
});
test('conflicting finished and unfinished states require a choice; same-position branches do not', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 49, {}, true); await record(b, 12, {}, false);
  await a.sync(); await b.sync(); await a.sync(); assert.equal(a.get(key).conflicts.length, 2);
  const chosen = a.get(key).heads.find(e => e.completed); await a.resolve(key, chosen.id, a.get(key).revision);
  await a.sync(); await b.sync(); assert.equal(b.get(key).completed, true);
  const base = a.get(key).clock;
  await record(a, 15, base, true); await record(b, 15, base, true);
  await a.sync(); await b.sync(); await a.sync(); assert.equal(a.get(key).conflicts.length, 0);
});
test('a conflict choice made before another update arrives is rejected as stale', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 10); await record(b, 20, {}); await a.sync(); await b.sync(); await a.sync();
  const dialog = a.get(key); await record(b, 21, b.get(key).heads.find(e => e.device === b.document.device).clock); await b.sync(); await a.sync();
  const result = await a.resolve(key, dialog.heads[0].id, dialog.revision);
  assert.equal(result.stale, true); assert.equal(a.get(key).conflicts.length, 2);
});
test('unavailable sharing retains a durable local outbox and recovers when the root returns', async t => {
  const { shared, device } = await fixture(t), a = await device('a');
  await fs.rmdir(shared); await record(a, 17); await a.sync();
  assert.equal(a.statuses.at(-1).state, 'offline');
  await assert.rejects(fs.access(shared)); // Never create a substitute local mount.
  const restarted = await device('a'); assert.equal(restarted.get(key).progress.page, 17);
  await fs.mkdir(shared); await restarted.sync(); const b = await device('b'); await b.sync();
  assert.equal(b.get(key).progress.page, 17);
});
test('network I/O cannot block saving a local bookmark', async t => {
  const { device } = await fixture(t), a = await device('a');
  let release;
  a.exchange = () => new Promise(resolve => { release = resolve; });
  const pending = a.sync(); await record(a, 12); assert.equal(a.get(key).progress.page, 12);
  release(); await pending;
});
test('damaged local stores are preserved and reported instead of silently reset', async t => {
  const { root, device } = await fixture(t); await device('a');
  const file = path.join(root, 'a', 'reading.json'); await fs.writeFile(file, '{broken');
  await assert.rejects(device('a')); assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});
test('a damaged peer file does not prevent valid bookmarks from being exchanged', async t => {
  const { shared, device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 22); await a.sync();
  const badFile = path.join(shared, '.panel-reader-progress', 'broken-device.json');
  await fs.writeFile(badFile, '{broken'); await b.sync();
  assert.equal(b.get(key).progress.page, 22); assert.equal(b.statuses.at(-1).state, 'partial');
  assert.equal(b.statuses.at(-1).issues[0].file, badFile);
  assert.equal(b.statuses.at(-1).issues[0].kind, 'invalid');
  assert.match(b.statuses.at(-1).message, /broken-device.json/);
  assert.equal(await fs.readFile(badFile, 'utf8'), '{broken');
});

test('transient incomplete network snapshots are retried before reporting damage', async t => {
  const { shared, device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 27); await a.sync();
  const file = path.join(shared, '.panel-reader-progress', `${a.document.device}.json`), good = await fs.readFile(file);
  await fs.writeFile(file, '{');
  const pending = b.sync();
  await new Promise(resolve => setTimeout(resolve, 40)); await fs.writeFile(file, good);
  await pending;
  assert.equal(b.statuses.at(-1).state, 'synced'); assert.equal(b.get(key).progress.page, 27);
});

test('a malformed own shared snapshot is repaired from the local outbox', async t => {
  const { shared, device } = await fixture(t), a = await device('a');
  await record(a, 13); await a.sync();
  const file = path.join(shared, '.panel-reader-progress', `${a.document.device}.json`);
  await fs.writeFile(file, '{broken'); await a.sync({ force: true });
  assert.equal(a.statuses.at(-1).state, 'synced');
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).entries[key][0].progress.page, 13);
  const b = await device('b'); await b.sync(); assert.equal(b.get(key).progress.page, 13);
  await fs.unlink(file); await a.sync(); assert.ok(await fs.stat(file));
});

test('network read failures are identified separately from invalid progress documents', async t => {
  const { shared, device } = await fixture(t), a = await device('a'); await a.sync();
  await fs.mkdir(path.join(shared, '.panel-reader-progress', 'unavailable-device.json'));
  await a.sync({ force: true });
  assert.equal(a.statuses.at(-1).state, 'partial');
  assert.equal(a.statuses.at(-1).issues[0].kind, 'unavailable');
  assert.ok(a.statuses.at(-1).issues[0].code);
  assert.doesNotMatch(a.statuses.at(-1).message, /damaged/);
});
test('concurrent updates to different comics never discard each other', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b'), other = `sha256:${'b'.repeat(64)}`;
  await record(a, 12); await b.record(other, { progress: position(18), pageCount: 50, completed: false });
  await a.sync(); await b.sync(); await a.sync();
  assert.equal(a.get(key).progress.page, 12); assert.equal(a.get(other).progress.page, 18);
  assert.equal(b.get(key).progress.page, 12); assert.equal(b.get(other).progress.page, 18);
});
test('Mark unread resets completion and bookmark across devices without allowing a stale snapshot to restore it', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b');
  await record(a, 49, {}, true); await a.sync(); await b.sync();
  await a.record(key, { progress: position(0), pageCount: 50, completed: false, unread: true, clock: a.get(key).clock });
  await a.sync({ force: true }); await b.sync(); await a.sync();
  assert.equal(b.get(key).completed, false); assert.equal(b.get(key).unread, true); assert.equal(b.get(key).progress.page, 0); assert.equal(b.get(key).conflicts.length, 0);
  await record(b, 5); await b.sync(); await a.sync(); assert.equal(a.get(key).unread, false); assert.equal(a.get(key).progress.page, 5);
});
test('old and indexed identifiers share causal history, resets, and future reading updates', async t => {
  const { device } = await fixture(t), a = await device('a'), b = await device('b'), indexed = `sha256:${'c'.repeat(64)}`;
  await record(a, 23); await a.linkKeys(indexed, key); await a.sync(); await b.sync();
  assert.equal(b.get(indexed).progress.page, 23);
  await b.record(indexed, { progress: position(24), pageCount: 50, completed: false, clock: b.get(indexed).clock }); await b.sync(); await a.sync();
  assert.equal(a.get(key).progress.page, 24); assert.equal(a.get(indexed).conflicts.length, 0);
  await a.record(key, { progress: position(0), pageCount: 50, completed: false, unread: true, clock: a.get(key).clock }); await a.sync(); await b.sync();
  assert.equal(b.get(indexed).unread, true); assert.equal(b.get(indexed).conflicts.length, 0);
});
test('unchanged automatic exchanges avoid rewrites; a manual update forces an upload', async t => {
  const { shared, device } = await fixture(t), a = await device('a'); await record(a, 12); await a.sync();
  const file = path.join(shared, '.panel-reader-progress', `${a.document.device}.json`), before = (await fs.stat(file)).mtimeMs;
  await new Promise(resolve => setTimeout(resolve, 20)); await a.sync(); assert.equal((await fs.stat(file)).mtimeMs, before);
  await a.sync({ force: true }); assert.ok((await fs.stat(file)).mtimeMs > before);
});
test('completion respects the final guided panel and actual continuous-scroll bottom', () => {
  assert.equal(readingComplete(position(9), 10), true);
  assert.equal(readingComplete(position(8), 10), false);
  assert.equal(readingComplete({ ...position(9, 'guided'), panel: 1 }, 10, 3), false);
  assert.equal(readingComplete({ ...position(9, 'guided'), panel: 2 }, 10, 3), true);
  assert.equal(readingComplete(position(9, 'guided'), 10, 0), false);
  assert.equal(readingComplete({ ...position(0, 'webtoon'), atEnd: false }, 1), false);
  assert.equal(readingComplete({ ...position(0, 'webtoon'), atEnd: true }, 1), true);
  assert.equal(readingComplete({ ...position(8, 'webtoon'), atEnd: true }, 10), true);
});
test('Continue reading keeps unfinished final-page panels and skips completed issues', () => {
  const books = [
    { id: 'a', title: '01', folder: '/series', lastRead: 10, pageCount: 2, progress: position(1, 'guided'), completed: false },
    { id: 'b', title: '02', folder: '/series', lastRead: 5, completed: true },
    { id: 'c', title: '03', folder: '/series' },
  ];
  assert.equal(seriesContinuations(books)[0].next.id, 'a');
  books[0].completed = true; assert.equal(seriesContinuations(books)[0].next.id, 'c');
});
