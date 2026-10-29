import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { openArchive } from '../core/archive.mjs';
import { mediaKey, coverPath, writeCache } from '../core/media-cache.mjs';
sharp.cache({ memory: 64, files: 8, items: 30 }); sharp.concurrency(2);
const archives = new Map(), images = new Map(); let memory = 0, detector, panelModule;
async function archive(file, source, force = false) {
  let value = archives.get(file);
  if (value && !force && source && value.stat.size === source.size && value.stat.mtimeMs === source.modified) return value;
  if (value && !force && !source && Date.now() - value.checked < 30000) return value;
  const stat = await fs.stat(file), version = `${stat.size}-${stat.mtimeMs}-${stat.ctimeMs}`;
  if (value && value.version !== version) { value.handle.close(); archives.delete(file); value = null; }
  if (value) { value.checked = Date.now(); value.stat = stat; archives.delete(file); archives.set(file, value); return value; }
  const fingerprint = mediaKey(file, { size: stat.size, modified: stat.mtimeMs });
  const handle = await openArchive(file, { rarCache: path.join(workerData.cache, `${fingerprint}-archive.rar`) });
  value = { handle, fingerprint, version, stat, checked: Date.now() }; archives.set(file, value);
  while (archives.size > 3) { const first = archives.keys().next().value; archives.get(first).handle.close(); archives.delete(first); }
  return value;
}
async function raw(file, page, source) {
  if (!Number.isInteger(page) || page < 0 || page >= (source?.pageCount ?? 100000)) throw new Error('Page is out of range.');
  let key = source ? `${mediaKey(file, source)}-${page}` : null;
  if (key && images.has(key)) return images.get(key);
  let bytes;
  if (key) try { bytes = await fs.readFile(path.join(workerData.cache, `${key}-original.bin`)); } catch {}
  if (!bytes) {
    const book = await archive(file, source); key = `${book.fingerprint}-${page}`;
    if (page >= book.handle.names.length) throw new Error('Page is out of range.');
    bytes = images.get(key) ?? await book.handle.read(page);
    if (bytes.length > 256 * 1024 ** 2) throw new Error('Image exceeds 256 MB.');
    await writeCache(path.join(workerData.cache, `${key}-original.bin`), bytes);
  }
  images.set(key, bytes); memory += bytes.length;
  while (memory > 128 * 1024 ** 2 && images.size > 1) { const first = images.keys().next().value; memory -= images.get(first).length; images.delete(first); }
  return bytes;
}
async function panelPath(file, page, source) { return path.join(workerData.cache, `${source ? mediaKey(file, source) : (await archive(file)).fingerprint}-${page}-panels.json`); }
const methods = {
  async original({ file, page, source }) {
    const bytes = await raw(file, page, source);
    return { bytes, name: (await archive(file, source)).handle.names[page] };
  },
  async open({ file }) {
    const book = await archive(file, undefined, true), { handle, fingerprint, stat } = book;
    let suggestedWebtoon = false, contentId = handle.contentId;
    if (handle.kind === 'image') {
      const bytes = await raw(file, 0, { size: stat.size, modified: stat.mtimeMs, pageCount: 1 });
      const meta = await sharp(bytes, { limitInputPixels: 400000000 }).metadata();
      suggestedWebtoon = (meta.autoOrient?.height ?? meta.height) > (meta.autoOrient?.width ?? meta.width) * 2;
      contentId = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
    }
    return { names: handle.names, kind: handle.kind, fingerprint, suggestedWebtoon, identity: contentId ? { contentId, fingerprintStamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`, fingerprintVersion: 2, size: stat.size, modified: stat.mtimeMs } : undefined };
  },
  async info({ file, page, source }) {
    const key = source ? mediaKey(file, source) : (await archive(file)).fingerprint;
    const location = path.join(workerData.cache, `${key}-${page}-info.json`);
    try { return JSON.parse(await fs.readFile(location, 'utf8')); } catch {}
    const meta = await sharp(await raw(file, page, source), { limitInputPixels: 400000000 }).metadata();
    const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
    const result = { width, height, tiles: Math.ceil(height / 4096), tileHeight: 4096 };
    await writeCache(location, JSON.stringify(result)); return result;
  },
  async image({ file, page, tile, thumbnail, source }) {
    // A cover hit must finish before any stat/open/read of the network source.
    let cached = thumbnail && source ? coverPath(workerData.cache, file, source) : null;
    if (cached) try { return { bytes: await fs.readFile(cached), mime: 'image/jpeg' }; } catch {}
    let key = source ? mediaKey(file, source) : null;
    if (!key) key = (await archive(file)).fingerprint;
    cached ??= thumbnail ? path.join(workerData.cache, `${key}-cover.jpg`) : tile !== undefined ? path.join(workerData.cache, `${key}-${page}-tile-${tile}.jpg`) : null;
    if (cached) try { return { bytes: await fs.readFile(cached), mime: 'image/jpeg' }; } catch {}
    const bytes = await raw(file, page, source);
    let pipeline = sharp(bytes, { limitInputPixels: 400000000 }).rotate();
    const meta = await pipeline.metadata();
    if (thumbnail) pipeline = pipeline.resize({ width: 360, height: 540, fit: 'inside', withoutEnlargement: true });
    else if (tile !== undefined) {
      const height = meta.autoOrient?.height ?? meta.height, width = meta.autoOrient?.width ?? meta.width;
      if (!Number.isInteger(tile) || tile < 0 || tile * 4096 >= height) throw new Error('Invalid image strip.');
      pipeline = pipeline.extract({ left: 0, top: tile * 4096, width, height: Math.min(4096, height - tile * 4096) });
    } else if (['jpeg', 'png', 'webp', 'avif'].includes(meta.format) && (!meta.orientation || meta.orientation === 1) && (meta.pages ?? 1) === 1) return { bytes, mime: `image/${meta.format}` };
    const output = await pipeline.flatten({ background: '#fff' }).jpeg({ quality: thumbnail ? 82 : 96, mozjpeg: thumbnail }).toBuffer();
    if (cached) await writeCache(cached, output);
    return { bytes: output, mime: 'image/jpeg' };
  },
  async panels({ file, page, settings, force, source }) {
    panelModule ??= await import('../core/panels.mjs');
    const location = await panelPath(file, page, source), optionsKey = `${panelModule.DETECTOR_VERSION}:${settings.detectionThreshold}:${settings.shapeDetection}:${settings.direction}`;
    if (!force) try { const result = JSON.parse(await fs.readFile(location, 'utf8')); if (result.manual || result.optionsKey === optionsKey) return result; } catch {}
    detector ??= new panelModule.PanelDetector(workerData.models);
    const result = await detector.detect(await raw(file, page, source), { threshold: settings.detectionThreshold, shapes: settings.shapeDetection, direction: settings.direction });
    result.optionsKey = optionsKey; await fs.writeFile(location, JSON.stringify(result)); return result;
  },
  async savePanels({ file, page, panels, source }) {
    panelModule ??= await import('../core/panels.mjs');
    const result = { ...(await methods.info({ file, page, source })), panels: panelModule.validatePanels(panels), manual: true, fallback: false, version: panelModule.DETECTOR_VERSION };
    await fs.writeFile(await panelPath(file, page, source), JSON.stringify(result)); return result;
  },
};
await fs.mkdir(workerData.cache, { recursive: true });
let queue = Promise.resolve();
parentPort.on('message', ({ id, method, args }) => {
  queue = queue.then(async () => {
    try {
      if (!methods[method]) throw new Error('Unknown worker operation.');
      const result = await methods[method](args);
      if (method === 'image' && args.thumbnail) {
        const book = archives.get(args.file);
        if (book?.handle.contentId && (!args.source || (book.stat.size === args.source.size && book.stat.mtimeMs === args.source.modified))) {
          const { stat } = book;
          result.identity = { contentId: book.handle.contentId, fingerprintStamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`, fingerprintVersion: 2, size: stat.size, modified: stat.mtimeMs };
        }
      }
      parentPort.postMessage({ id, result });
    }
    catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
});
