import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { openArchive } from '../core/archive.mjs';
import { PanelDetector, DETECTOR_VERSION, validatePanels } from '../core/panels.mjs';
sharp.cache({ memory: 64, files: 8, items: 30 });
sharp.concurrency(2);
const detector = new PanelDetector(workerData.models);
const archives = new Map(), images = new Map(); let memory = 0;
async function archive(file) {
  const stat = await fs.stat(file), version = `${stat.size}-${stat.mtimeMs}`;
  let value = archives.get(file);
  if (value && value.version !== version) { value.handle.close(); archives.delete(file); value = null; }
  if (value) { archives.delete(file); archives.set(file, value); return value; }
  const handle = await openArchive(file);
  const fingerprint = createHash('sha256').update(`${file}:${version}`).digest('hex');
  value = { handle, fingerprint, version };
  archives.set(file, value);
  while (archives.size > 3) { const oldest = archives.keys().next().value; archives.get(oldest).handle.close(); archives.delete(oldest); }
  return value;
}
async function raw(file, page) {
  const book = await archive(file), key = `${book.fingerprint}-${page}`;
  if (!Number.isInteger(page) || page < 0 || page >= book.handle.names.length) throw new Error('Page is out of range.');
  if (images.has(key)) { const value = images.get(key); images.delete(key); images.set(key, value); return value; }
  const bytes = await book.handle.read(page);
  if (bytes.length > 256 * 1024 ** 2) throw new Error('Image exceeds 256 MB.');
  images.set(key, bytes); memory += bytes.length;
  while (memory > 128 * 1024 ** 2 && images.size > 1) { const first = images.keys().next().value; memory -= images.get(first).length; images.delete(first); }
  return bytes;
}
async function panelPath(file, page) { return path.join(workerData.cache, `${(await archive(file)).fingerprint}-${page}-panels.json`); }
const methods = {
  async open({ file }) {
    const { handle, fingerprint } = await archive(file); let suggestedWebtoon = false;
    if (handle.kind === 'image') { const meta = await sharp(await handle.read(0), { limitInputPixels: 400000000 }).metadata(); suggestedWebtoon = (meta.autoOrient?.height ?? meta.height) > (meta.autoOrient?.width ?? meta.width) * 2; }
    return { names: handle.names, kind: handle.kind, fingerprint, suggestedWebtoon };
  },
  async info({ file, page }) {
    const meta = await sharp(await raw(file, page), { limitInputPixels: 400000000 }).metadata();
    const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
    return { width, height, tiles: Math.ceil(height / 4096), tileHeight: 4096 };
  },
  async image({ file, page, tile, thumbnail }) {
    const book = await archive(file);
    const cached = thumbnail ? path.join(workerData.cache, `${book.fingerprint}-cover.jpg`) : null;
    if (cached) { try { return { bytes: await fs.readFile(cached), mime: 'image/jpeg' }; } catch {} }
    const bytes = await raw(file, page);
    let pipeline = sharp(bytes, { limitInputPixels: 400000000 }).rotate();
    const meta = await pipeline.metadata();
    if (thumbnail) pipeline = pipeline.resize({ width: 360, height: 540, fit: 'inside', withoutEnlargement: true });
    else if (tile !== undefined) {
      const height = meta.autoOrient?.height ?? meta.height, width = meta.autoOrient?.width ?? meta.width;
      if (!Number.isInteger(tile) || tile < 0 || tile * 4096 >= height) throw new Error('Invalid image strip.');
      pipeline = pipeline.extract({ left: 0, top: tile * 4096, width, height: Math.min(4096, height - tile * 4096) });
    } else if (['jpeg', 'png', 'webp', 'avif'].includes(meta.format) && (!meta.orientation || meta.orientation === 1) && (meta.pages ?? 1) === 1) return { bytes, mime: `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}` };
    const output = await pipeline.flatten({ background: '#fff' }).jpeg({ quality: thumbnail ? 82 : 96, mozjpeg: thumbnail }).toBuffer();
    if (cached) await fs.writeFile(cached, output);
    return { bytes: output, mime: 'image/jpeg' };
  },
  async panels({ file, page, settings, force }) {
    const location = await panelPath(file, page);
    const optionsKey = `${DETECTOR_VERSION}:${settings.detectionThreshold}:${settings.shapeDetection}:${settings.direction}`;
    if (!force) try { const result = JSON.parse(await fs.readFile(location, 'utf8')); if (result.manual || result.optionsKey === optionsKey) return result; } catch {}
    const result = await detector.detect(await raw(file, page), { threshold: settings.detectionThreshold, shapes: settings.shapeDetection, direction: settings.direction });
    result.optionsKey = optionsKey;
    await fs.writeFile(location, JSON.stringify(result));
    return result;
  },
  async savePanels({ file, page, panels }) {
    const result = { ...(await methods.info({ file, page })), panels: validatePanels(panels), manual: true, fallback: false, version: DETECTOR_VERSION };
    await fs.writeFile(await panelPath(file, page), JSON.stringify(result));
    return result;
  },
};
await fs.mkdir(workerData.cache, { recursive: true });
let queue = Promise.resolve();
parentPort.on('message', ({ id, method, args }) => {
  queue = queue.then(async () => {
    try { if (!methods[method]) throw new Error('Unknown worker operation.'); parentPort.postMessage({ id, result: await methods[method](args) }); }
    catch (error) { parentPort.postMessage({ id, error: error.message }); }
  });
});
