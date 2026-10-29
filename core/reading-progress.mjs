import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { isImage, naturalCompare, zipOpen, zipEntries, zipIdentity } from './archive.mjs';
import { abortable, checkAbort } from './io.mjs';
export { readingComplete, legacyCompleted } from './reading-state.mjs';

const VERSION = 1;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);
const contentKey = value => /^(sha256|pages-sha256):[a-f0-9]{64}$/.test(value);
const empty = () => ({ version: VERSION, device: randomUUID(), sequence: 0, entries: {}, aliases: {} });
const stamp = stat => [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
async function digest(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}
async function source(file) {
  const stat = await fs.stat(file);
  if (!stat.isDirectory()) return { stamp: stamp(stat), files: [file], folder: false, stat };
  const names = (await fs.readdir(file, { withFileTypes: true })).filter(e => e.isFile() && isImage(e.name)).map(e => e.name).sort(naturalCompare);
  if (!names.length) throw new Error('No supported images in this folder.');
  const metadata = [];
  for (const name of names) metadata.push([name, stamp(await fs.stat(path.join(file, name)))]);
  return { stamp: createHash('sha256').update(JSON.stringify(metadata)).digest('hex'), files: names.map(name => path.join(file, name)), folder: true, stat };
}
// Paths and filenames are only cache hints; the identity itself contains bytes alone.
export async function fingerprint(file, cached = {}, { signal, known } = {}) {
  checkAbort(signal);
  if (known?.contentId) return { ...known, legacyContentId: cached.fingerprintStamp === known.fingerprintStamp && cached.fingerprintVersion !== 2 && cached.contentId !== known.contentId ? cached.contentId : undefined };
  const before = await abortable(source(file), signal); checkAbort(signal);
  if (contentKey(cached.contentId) && before.stamp === cached.fingerprintStamp && cached.fingerprintVersion === 2) return { contentId: cached.contentId, fingerprintStamp: cached.fingerprintStamp, fingerprintVersion: 2, size: before.stat.size, modified: before.stat.mtimeMs };
  const identity = { fingerprintStamp: before.stamp, fingerprintVersion: 2, size: before.stat.size, modified: before.stat.mtimeMs };
  if (!before.folder) {
    const handle = await fs.open(file, 'r'), signature = Buffer.alloc(4);
    try { await handle.read(signature, 0, 4, 0); } finally { await handle.close(); }
    if (signature[0] === 0x50 && signature[1] === 0x4b) {
      const zip = await zipOpen(file, before.stat);
      try { identity.contentId = zipIdentity(await abortable(zipEntries(zip), signal)); }
      finally { zip.close(); }
      if (stamp(await fs.stat(file)) !== before.stamp) throw new Error('Comic changed while being identified.');
      if (cached.fingerprintStamp === before.stamp && cached.fingerprintVersion !== 2 && cached.contentId !== identity.contentId) identity.legacyContentId = cached.contentId;
      return identity;
    }
  }
  const hashes = [];
  for (const entry of before.files) { checkAbort(signal); hashes.push(await digest(entry, signal)); }
  if ((await source(file)).stamp !== before.stamp) throw new Error('Comic changed while being identified. Try again after copying finishes.');
  const contentId = before.folder ? `pages-sha256:${createHash('sha256').update(hashes.join('')).digest('hex')}` : `sha256:${hashes[0]}`;
  return { ...identity, contentId };
}

export function joinClocks(events) {
  const clock = {};
  for (const event of events) for (const [device, count] of Object.entries(event.clock)) clock[device] = Math.max(clock[device] ?? 0, count);
  return clock;
}
const covers = (a, b) => Object.entries(b.clock).every(([device, count]) => (a.clock[device] ?? 0) >= count);
const samePosition = (a, b) => !!a.unread === !!b.unread && a.completed === b.completed && a.pageCount === b.pageCount && JSON.stringify(a.progress) === JSON.stringify(b.progress);
export function mergeHeads(...groups) {
  const all = [...new Map(groups.flat().map(event => [event.id, event])).values()];
  return all.filter(event => !all.some(other => other.id !== event.id && covers(other, event) && (!covers(event, other) || other.id > event.id)))
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
}
export function snapshot(heads = []) {
  const event = heads[0];
  if (!event) return { heads: [], clock: {}, revision: '', conflicts: [] };
  return { heads, clock: joinClocks(heads), revision: heads.map(e => e.id).sort().join(','), progress: event.progress, completed: event.completed, unread: !!event.unread, pageCount: event.pageCount, lastRead: event.at,
    conflicts: heads.every(head => samePosition(head, event)) ? [] : heads.map(({ id, progress, completed, unread, at }) => ({ id, progress, completed, unread: !!unread, at })) };
}
function validEvent(event) {
  if (!event || !identifier(event.id) || !identifier(event.device) || !Number.isFinite(event.at) || event.at < 0 || typeof event.completed !== 'boolean') return false;
  if (event.unread !== undefined && typeof event.unread !== 'boolean') return false;
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
  if (document.aliases && (typeof document.aliases !== 'object' || Array.isArray(document.aliases) || Object.entries(document.aliases).some(([key, group]) => !contentKey(key) || !Array.isArray(group) || group.length > 32 || !group.every(contentKey)))) throw new Error('Invalid reading progress identifiers.');
  return document;
}
async function readDocument(file, stat) {
  if ((stat ?? await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('Reading progress file is too large.');
  return validate(JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '')));
}
async function atomicWrite(file, document) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(document)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
  }
  finally { await fs.unlink(temp).catch(() => {}); }
}

async function readPeer(file, stat) {
  // SMB/cloud mounts can briefly expose a replacement as incomplete or locked.
  // Retry before diagnosing it, and never call permissions/network errors damage.
  try { return await readDocument(file, stat); }
  catch {
    await new Promise(resolve => setTimeout(resolve, 150));
    return readDocument(file);
  }
}
function peerIssue(file, error) {
  const kind = error.code ? 'unavailable' : 'invalid';
  const reason = error instanceof SyntaxError ? 'incomplete or invalid JSON' : error.message;
  return { file, kind, reason, code: error.code };
}

// Local mutations never wait for network I/O. Every installation owns a separate
// shared snapshot, and vectors retain concurrent positions until explicitly chosen.
export class ReadingProgress {
  constructor({ localFile, sharedFolder = () => '', onChange = () => {}, onStatus = () => {} }) {
    this.localFile = localFile; this.sharedFolder = sharedFolder; this.onChange = onChange; this.onStatus = onStatus;
    this.document = empty(); this.queue = Promise.resolve(); this.generation = 0; this.syncedGeneration = -1;
    this.peers = new Map(); this.targets = new Set(); this.lastTarget = '';
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
  async linkKeys(key, legacy) {
    if (!contentKey(key) || !contentKey(legacy) || key === legacy) return;
    return this.enqueue(async () => {
      const next = structuredClone(this.document); next.aliases ??= {};
      const group = [...new Set([key, legacy, ...(next.aliases[key] ?? []), ...(next.aliases[legacy] ?? [])])];
      const heads = mergeHeads(...group.map(id => next.entries[id] ?? []));
      for (const id of group) { next.aliases[id] = group; if (heads.length) next.entries[id] = heads; }
      await atomicWrite(this.localFile, next); this.document = next; this.generation++; this.onChange(group, false);
    });
  }
  async record(key, { progress, completed, unread = false, pageCount, clock = {}, at = Date.now() }) {
    return this.enqueue(async () => {
      if (!contentKey(key)) throw new Error('Comic has no content identifier.');
      const next = structuredClone(this.document);
      const sequence = Math.max(next.sequence, clock[next.device] ?? 0) + 1;
      const event = { id: randomUUID(), device: next.device, clock: { ...clock, [next.device]: sequence }, at, progress, completed: !!completed, unread: !!unread, pageCount };
      if (!validEvent(event)) throw new Error('Invalid reading position.');
      next.sequence = sequence;
      const group = next.aliases?.[key] ?? [key], heads = mergeHeads(...group.map(id => next.entries[id] ?? []), [event]);
      for (const id of group) next.entries[id] = heads;
      await atomicWrite(this.localFile, next); this.document = next; this.generation++;
      this.onChange(group, false); return { ...this.get(key), event };
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
      next.sequence = sequence; const group = next.aliases?.[key] ?? [key]; for (const id of group) next.entries[id] = [event];
      await atomicWrite(this.localFile, next); this.document = next; this.generation++;
      this.onChange(group, false); return this.get(key);
    });
  }
  async sync({ force = false } = {}) {
    const folder = this.sharedFolder();
    if (!folder) { this.onStatus({ state: 'off', message: 'Progress is saved on this device.' }); return; }
    if (this.syncing) { if (!force) return this.syncing; await this.syncing; return this.sync({ force: true }); }
    this.syncing = this.exchange(folder, force).catch(error => {
      if (this.sharedFolder() === folder) this.onStatus({ state: 'offline', message: `Saved on this device. Sharing will retry: ${error.message}` });
    }).finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async exchange(folder, force = false) {
    // Do not create the selected root: a disconnected mount must not become a
    // new local directory. Only create our private subfolder inside an existing root.
    if (!(await fs.stat(folder)).isDirectory()) throw new Error('Shared folder is unavailable.');
    const target = path.join(folder, '.panel-reader-progress');
    if (!this.targets.has(target)) { await fs.mkdir(target, { recursive: true }); this.targets.add(target); }
    try { return await this.exchangeFiles(folder, target, force); }
    catch (error) { if (error.code === 'ENOENT') this.targets.delete(target); throw error; }
  }
  async exchangeFiles(folder, target, force) {
    const names = (await fs.readdir(target)).filter(name => /^[a-zA-Z0-9-]{1,80}\.json$/.test(name));
    const documents = [], invalid = [], versions = new Map();
    for (const name of names) {
      const file = path.join(target, name);
      try {
        const stat = await fs.stat(file), version = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        if (!force && this.peers.get(file) === version) continue;
        documents.push(await readPeer(file, stat)); versions.set(file, version);
      }
      catch (error) { if (error.code !== 'ENOENT') invalid.push(peerIssue(file, error)); }
    }
    if (this.sharedFolder() !== folder) return;
    const changed = await this.enqueue(async () => {
      const next = structuredClone(this.document), changed = new Set();
      next.aliases ??= {};
      let aliasesChanged = false;
      for (const remote of documents) {
        for (const [key, group] of Object.entries(remote.aliases ?? {})) {
          const joined = [...new Set([key, ...group, ...(next.aliases[key] ?? []), ...group.flatMap(id => next.aliases[id] ?? [])])].sort();
          for (const id of joined) if (JSON.stringify(next.aliases[id]) !== JSON.stringify(joined)) { next.aliases[id] = joined; aliasesChanged = true; }
        }
        for (const [key, heads] of Object.entries(remote.entries)) {
          const merged = mergeHeads(next.entries[key] ?? [], heads);
          if (JSON.stringify(merged) !== JSON.stringify(next.entries[key] ?? [])) { next.entries[key] = merged; changed.add(key); }
        }
      }
      for (const group of Object.values(next.aliases)) {
        const merged = mergeHeads(...group.map(key => next.entries[key] ?? []));
        for (const key of group) if (merged.length && JSON.stringify(merged) !== JSON.stringify(next.entries[key] ?? [])) { next.entries[key] = merged; changed.add(key); }
      }
      // A copied/restored profile may have published a larger local sequence.
      for (const heads of Object.values(next.entries)) for (const head of heads) next.sequence = Math.max(next.sequence, head.clock[next.device] ?? 0);
      if (changed.size || aliasesChanged) { await atomicWrite(this.localFile, next); this.document = next; this.generation++; this.onChange([...changed], true); }
      return { document: structuredClone(this.document), generation: this.generation };
    });
    for (const [file, version] of versions) this.peers.set(file, version);
    if (this.sharedFolder() !== folder) return;
    const ownFile = path.join(target, `${this.document.device}.json`);
    if (force || this.lastTarget !== target || this.syncedGeneration !== changed.generation || !names.includes(path.basename(ownFile)) || invalid.some(issue => issue.file === ownFile)) {
      await atomicWrite(ownFile, changed.document);
      const stat = await fs.stat(ownFile); this.peers.set(ownFile, `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
    }
    if (this.sharedFolder() !== folder) return;
    this.syncedGeneration = changed.generation;
    this.lastTarget = target;
    // A broken snapshot owned by this installation has just been replaced from
    // its durable local store. Other devices' files are always preserved.
    const issues = invalid.filter(issue => issue.file !== ownFile);
    const issue = issues[0];
    this.onStatus({ state: issues.length ? 'partial' : this.generation === changed.generation ? 'synced' : 'pending', message: issue ? `Progress uploaded. Could not read ${path.basename(issue.file)}: ${issue.reason}${issues.length > 1 ? ` (${issues.length} device files affected)` : ''}. Will retry.` : this.generation === changed.generation ? 'Reading progress is shared.' : 'New progress is waiting to be shared.', issues, lastSynced: Date.now() });
  }
  async flush() { await this.queue; }
}
