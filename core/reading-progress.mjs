import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { isImage, naturalCompare } from './archive.mjs';
export { readingComplete, legacyCompleted } from './reading-state.mjs';

const VERSION = 1;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const contentKey = value => /^(sha256|pages-sha256):[a-f0-9]{64}$/.test(value);
const empty = () => ({ version: VERSION, device: randomUUID(), sequence: 0, entries: {} });
const stamp = stat => [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function source(file) {
  const stat = await fs.stat(file);
  if (!stat.isDirectory()) return { stamp: stamp(stat), files: [file], folder: false };
  const names = (await fs.readdir(file, { withFileTypes: true })).filter(e => e.isFile() && isImage(e.name)).map(e => e.name).sort(naturalCompare);
  if (!names.length) throw new Error('No supported images in this folder.');
  const metadata = [];
  for (const name of names) metadata.push([name, stamp(await fs.stat(path.join(file, name)))]);
  return { stamp: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'), files: names.map(name => path.join(file, name)), folder: true };
}
// Paths and filenames are only cache hints; the identity itself contains bytes alone.
export async function fingerprint(file, cached = {}) {
  const before = await source(file);
  if (contentKey(cached.contentId) && before.stamp === cached.fingerprintStamp) return { contentId: cached.contentId, fingerprintStamp: cached.fingerprintStamp };
  const hashes = [];
  for (const entry of before.files) hashes.push(await digest(entry));
  if ((await source(file)).stamp !== before.stamp) throw new Error('Comic changed while being identified. Try again after copying finishes.');
  const contentId = before.folder ? `pages-sha256:${createHash('sha256').update(hashes.join('')).digest('hex')}` : `sha256:${hashes[0]}`;
  return { contentId, fingerprintStamp: before.stamp };
}

export function joinClocks(events) {
  const clock = {};
  for (const event of events) for (const [device, count] of Object.entries(event.clock)) clock[device] = Math.max(clock[device] ?? 0, count);
  return clock;
}
const covers = (a, b) => Object.entries(b.clock).every(([device, count]) => (a.clock[device] ?? 0) >= count);
const samePosition = (a, b) => a.completed === b.completed && a.pageCount === b.pageCount && JSON.stringify(a.progress) === JSON.stringify(b.progress);
export function mergeHeads(...groups) {
  const all = [...new Map(groups.flat().map(event => [event.id, event])).values()];
  return all.filter(event => !all.some(other => other.id !== event.id && covers(other, event) && (!covers(event, other) || other.id > event.id)))
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}
export function snapshot(heads = []) {
  const event = heads[0];
  if (!event) return { heads: [], clock: {}, revision: '', conflicts: [] };
  return { heads, clock: joinClocks(heads), revision: heads.map(e => e.id).sort().join(','), progress: event.progress, completed: event.completed, pageCount: event.pageCount, lastRead: event.at,
    conflicts: heads.every(head => samePosition(head, event)) ? [] : heads.map(({ id, progress, completed, at }) => ({ id, progress, completed, at })) };
}
function validEvent(event) {
  if (!event || !identifier(event.id) || !identifier(event.device) || !Number.isFinite(event.at) || event.at < 0 || typeof event.completed !== 'boolean') return false;
  if (!Number.isSafeInteger(event.pageCount) || event.pageCount < 1 || event.pageCount > 100000) return false;
  const p = event.progress;
  if (!p || !Number.isInteger(p.page) || p.page < 0 || p.page >= event.pageCount || !Number.isInteger(p.panel) || p.panel < 0 || !Number.isFinite(p.offset) || p.offset < 0 || p.offset > 1 || !['page', 'guided', 'webtoon'].includes(p.mode)) return false;
  const clock = event.clock;
  return clock && Object.keys(clock).length <= 1000 && Object.entries(clock).every(([device, count]) => identifier(device) && Number.isSafeInteger(count) && count > 0) && clock[event.device] > 0;
}
function validate(document) {
  if (document?.version !== VERSION || !identifier(document.device) || !Number.isSafeInteger(document.sequence) || document.sequence < 0 || !document.entries || Array.isArray(document.entries) || typeof document.entries !== 'object') throw new Error('Unsupported or damaged reading progress file.');
  const entries = Object.entries(document.entries);
  if (entries.length > 100000 || entries.some(([key, heads]) => !contentKey(key) || !Array.isArray(heads) || heads.length > 1000 || !heads.every(validEvent))) throw new Error('Invalid reading progress records.');
  return document;
}
async function readDocument(file) {
  if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('Reading progress file is too large.');
  return validate(JSON.parse(await fs.readFile(file, 'utf8')));
}
async function atomicWrite(file, document) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temp, JSON.stringify(document), { flag: 'wx' }); await fs.rename(temp, file); }
  finally { await fs.unlink(temp).catch(() => {}); }
}

// Local mutations never wait for network I/O. Every installation owns a separate
// shared snapshot, and vectors retain concurrent positions until explicitly chosen.
export class ReadingProgress {
  constructor({ localFile, sharedFolder = () => '', onChange = () => {}, onStatus = () => {} }) {
    this.localFile = localFile; this.sharedFolder = sharedFolder; this.onChange = onChange; this.onStatus = onStatus;
    this.document = empty(); this.queue = Promise.resolve(); this.generation = 0; this.syncedGeneration = -1;
  }
  enqueue(fn) {
    const next = this.queue.catch(() => {}).then(fn); this.queue = next; return next;
  }
  async init() {
    await fs.mkdir(path.dirname(this.localFile), { recursive: true });
    try { this.document = await readDocument(this.localFile); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await atomicWrite(this.localFile, this.document); }
  }
  get(key) { return snapshot(this.document.entries[key]); }
  async record(key, { progress, completed, pageCount, clock = {}, at = Date.now() }) {
    return this.enqueue(async () => {
      if (!contentKey(key)) throw new Error('Comic has no content identifier.');
      const next = structuredClone(this.document);
      const sequence = Math.max(next.sequence, clock[next.device] ?? 0) + 1;
      const event = { id: randomUUID(), device: next.device, clock: { ...clock, [next.device]: sequence }, at, progress, completed: !!completed, pageCount };
      if (!validEvent(event)) throw new Error('Invalid reading position.');
      next.sequence = sequence; next.entries[key] = mergeHeads(next.entries[key] ?? [], [event]);
      await atomicWrite(this.localFile, next); this.document = next; this.generation++;
      this.onChange([key], false); return { ...this.get(key), event };
    });
  }
  async resolve(key, eventId, revision) {
    // Check and write in the same queue turn so a newly arrived branch is never
    // silently acknowledged by a choice made against an older dialog.
    return this.enqueue(async () => {
      const current = this.get(key), chosen = current.heads.find(e => e.id === eventId);
      if (current.revision !== revision || !chosen) return { stale: true, ...current };
      const next = structuredClone(this.document), sequence = next.sequence + 1;
      const event = { ...chosen, id: randomUUID(), device: next.device, clock: { ...current.clock, [next.device]: sequence } };
      next.sequence = sequence; next.entries[key] = [event];
      await atomicWrite(this.localFile, next); this.document = next; this.generation++;
      this.onChange([key], false); return this.get(key);
    });
  }
  async sync() {
    const folder = this.sharedFolder();
    if (!folder) { this.onStatus({ state: 'off', message: 'Progress is saved on this device.' }); return; }
    if (this.syncing) return this.syncing;
    this.syncing = this.exchange(folder).catch(error => {
      if (this.sharedFolder() === folder) this.onStatus({ state: 'offline', message: `Saved on this device. Sharing will retry: ${error.message}` });
    }).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async exchange(folder) {
    // Do not create the selected root: a disconnected mount must not become a
    // new local directory. Only create our private subfolder inside an existing root.
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Shared folder is unavailable.');
    const target = path.join(folder, '.panel-reader-progress'); await fs.mkdir(target, { recursive: true });
    const names = (await fs.readdir(target)).filter(name => /^[a-zA-Z0-9-]{1,80}\.json$/.test(name));
    const documents = [], invalid = [];
    for (const name of names) {
      try { documents.push(await readDocument(path.join(target, name))); }
      catch (error) { if (error.code !== 'ENOENT') invalid.push(name); }
    }
    if (this.sharedFolder() !== folder) return;
    const changed = await this.enqueue(async () => {
      const next = structuredClone(this.document), changed = new Set();
      for (const remote of documents) for (const [key, heads] of Object.entries(remote.entries)) {
        const merged = mergeHeads(next.entries[key] ?? [], heads);
        if (JSON.stringify(merged) !== JSON.stringify(next.entries[key] ?? [])) { next.entries[key] = merged; changed.add(key); }
      }
      // A copied/restored profile may have published a larger local sequence.
      for (const heads of Object.values(next.entries)) for (const head of heads) next.sequence = Math.max(next.sequence, head.clock[next.device] ?? 0);
      if (changed.size) { await atomicWrite(this.localFile, next); this.document = next; this.generation++; this.onChange([...changed], true); }
      return { document: structuredClone(this.document), generation: this.generation };
    });
    if (this.sharedFolder() !== folder) return;
    await atomicWrite(path.join(target, `${this.document.device}.json`), changed.document);
    if (this.sharedFolder() !== folder) return;
    this.syncedGeneration = changed.generation;
    this.onStatus({ state: invalid.length ? 'partial' : this.generation === changed.generation ? 'synced' : 'pending', message: invalid.length ? 'Progress is shared, but a damaged device file could not be read.' : this.generation === changed.generation ? 'Reading progress is shared.' : 'New progress is waiting to be shared.', lastSynced: Date.now() });
  }
  async flush() { await this.queue; }
}
