import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import unrar from 'node-unrar-js';
import { writeCache } from './media-cache.mjs';
export const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;
export const COMIC_RE = /\.(cbz|cbr|zip|rar)$/i;
export const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;
export const MAX_ENTRY = 256 * 1024 * 1024;
export function isImage(name) {
  return IMAGE_RE.test(name) && !name.split(/[\\/]/).some(part => part.startsWith('.') || part === '__MACOSX');
}
// ZIP parsers otherwise issue separate tiny network reads for every directory
// entry. Cache aligned directory blocks and stream larger page ranges directly.
export class ZipRangeReader extends yauzl.RandomAccessReader {
  constructor(handle, size, onRead = () => {}) { super(); this.handle = handle; this.size = size; this.blocks = new Map(); this.onRead = onRead; }
  async range(start, end) {
    const chunks = [];
    for (let position = start; position < end;) {
      const base = Math.floor(position / 65536) * 65536;
      if (!this.blocks.has(base)) {
        const task = (async () => {
          const buffer = Buffer.alloc(Math.min(65536, this.size - base)); let offset = 0;
          while (offset < buffer.length) { const { bytesRead } = await this.handle.read(buffer, offset, buffer.length - offset, base + offset); this.onRead(bytesRead); if (!bytesRead) throw new Error('Unexpected ZIP end of file.'); offset += bytesRead; }
          return buffer;
        })();
        this.blocks.set(base, task);
        while (this.blocks.size > 16) this.blocks.delete(this.blocks.keys().next().value);
      }
      const block = await this.blocks.get(base), count = Math.min(end - position, block.length - (position - base));
      if (count <= 0) throw new Error('Invalid ZIP range.');
      chunks.push(block.subarray(position - base, position - base + count)); position += count;
    }
    return Buffer.concat(chunks);
  }
  read(buffer, offset, length, position, callback) { this.range(position, position + length).then(bytes => { bytes.copy(buffer, offset); callback(null, bytes.length); }, callback); }
  _readStreamForRange(start, end) {
    if (end - start <= 65536) return Readable.from((async function* (reader) { yield await reader.range(start, end); })(this));
    return this.handle.createReadStream({ start, end: end - 1, autoClose: false, highWaterMark: 256 * 1024 });
  }
  close(callback) { this.handle.close().then(() => callback(), callback); }
}
export async function zipOpen(file, stat, onRead) {
  stat ??= await fs.stat(file);
  const handle = await fs.open(file, 'r'), reader = new ZipRangeReader(handle, stat.size, onRead);
  return new Promise((resolve, reject) => yauzl.fromRandomAccessReader(reader, stat.size, { lazyEntries: true, autoClose: false }, (error, zip) => {
    if (error) { handle.close().catch(() => {}); reject(error); } else resolve(zip);
  }));
}
export function zipEntries(zip) {
  return new Promise((resolve, reject) => {
    const all = [];
    zip.on('error', reject);
    zip.on('entry', entry => {
      all.push(entry);
      if (all.length > 50000) { reject(new Error('Archive has more than 50,000 entries.')); zip.close(); return; }
      zip.readEntry();
    });
    zip.once('end', () => resolve(all));
    zip.readEntry();
  });
}
export function zipIdentity(entries) {
  // Every entry's checksum, size, name and position participates, including
  // metadata. Covers alone or a filename are never used to match two comics.
  return 'sha256:' + createHash('sha256').update('panel-reader-zip-index-v2\n').update(JSON.stringify(entries.map(e => [e.fileName, e.crc32, e.uncompressedSize, e.compressedSize, e.compressionMethod, e.relativeOffsetOfLocalHeader]))).digest('hex');
}
function zipRead(zip, entry) {
  if (entry.uncompressedSize > MAX_ENTRY) throw new Error('Image exceeds the 256 MB safety limit.');
  if (entry.generalPurposeBitFlag & 1) throw new Error('Password-protected ZIP files are not supported.');
  return new Promise((resolve, reject) => zip.openReadStream(entry, (e, stream) => {
    if (e) return reject(e);
    const chunks = []; let length = 0;
    stream.on('data', chunk => { length += chunk.length; if (length > MAX_ENTRY) stream.destroy(new Error('Image is too large.')); else chunks.push(chunk); });
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  }));
}
export async function openArchive(file, { rarCache, onRead } = {}) {
  const stat = await fs.stat(file);
  if (stat.isDirectory()) {
    const names = (await fs.readdir(file, { withFileTypes: true })).filter(e => e.isFile() && isImage(e.name)).map(e => e.name).sort(naturalCompare);
    if (!names.length) throw new Error('No supported images in this folder.');
    return { names, kind: 'folder', read: i => { if (!names[i]) throw new Error('Page does not exist.'); return fs.readFile(path.join(file, names[i])); }, close() {} };
  }
  if (isImage(path.basename(file))) return { names: [path.basename(file)], kind: 'image', read: i => { if (i !== 0) throw new Error('Page does not exist.'); return fs.readFile(file); }, close() {} };
  const handle = await fs.open(file, 'r');
  const signature = Buffer.alloc(8);
  try { await handle.read(signature, 0, 8, 0); } finally { await handle.close(); }
  if (signature[0] === 0x50 && signature[1] === 0x4b) {
    const zip = await zipOpen(file, stat, onRead);
    try {
      const catalog = await zipEntries(zip), entries = catalog.filter(e => isImage(e.fileName)).sort((a, b) => naturalCompare(a.fileName, b.fileName));
      if (!entries.length) throw new Error('This archive contains no supported images.');
      return { names: entries.map(e => e.fileName), kind: 'zip', contentId: zipIdentity(catalog), read: i => { if (!entries[i]) throw new Error('Page does not exist.'); return zipRead(zip, entries[i]); }, close: () => zip.close() };
    } catch (e) { zip.close(); throw e; }
  }
  if (signature.subarray(0, 4).toString() === 'Rar!') {
    if (stat.size > 1.5 * 1024 ** 3) throw new Error('RAR archives above 1.5 GB are not supported. Repack as CBZ.');
    let data;
    if (rarCache) try { data = await fs.readFile(rarCache); } catch {}
    if (!data) { data = await fs.readFile(file); if (rarCache) await writeCache(rarCache, data); }
    const extractor = await unrar.createExtractorFromData({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    const entries = [...extractor.getFileList().fileHeaders].filter(e => !e.flags.directory && isImage(e.name)).sort((a, b) => naturalCompare(a.name, b.name));
    if (!entries.length) throw new Error('This archive contains no supported images.');
    return {
      names: entries.map(e => e.name), kind: 'rar', contentId: 'sha256:' + createHash('sha256').update(data).digest('hex'),
      async read(i) {
        const entry = entries[i];
        if (!entry) throw new Error('Page does not exist.');
        if (entry.unpSize > MAX_ENTRY) throw new Error('Image exceeds the 256 MB safety limit.');
        // Exhaust the generator to release the WASM archive handle, including for solid RARs.
        const files = [...extractor.extract({ files: [entry.name] }).files];
        if (!files[0]?.extraction) throw new Error(`Could not extract ${entry.name}`);
        return Buffer.from(files[0].extraction);
      }, close() {},
    };
  }
  throw new Error('Unsupported archive. Choose a ZIP/CBZ, RAR/CBR, or an image folder.');
}
