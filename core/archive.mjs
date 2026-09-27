import fs from 'node:fs/promises';
import path from 'node:path';
import yauzl from 'yauzl';
import unrar from 'node-unrar-js';
export const IMAGE_RE = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;
export const COMIC_RE = /\.(cbz|cbr|zip|rar)$/i;
export const naturalCompare = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;
export const MAX_ENTRY = 256 * 1024 * 1024;
export function isImage(name) {
  return IMAGE_RE.test(name) && !name.split(/[\\/]/).some(part => part.startsWith('.') || part === '__MACOSX');
}
function zipOpen(file) {
  return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, autoClose: false }, (e, z) => e ? reject(e) : resolve(z)));
}
function zipEntries(zip) {
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
export async function openArchive(file) {
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
    const zip = await zipOpen(file);
    try {
      const entries = (await zipEntries(zip)).filter(e => isImage(e.fileName)).sort((a, b) => naturalCompare(a.fileName, b.fileName));
      if (!entries.length) throw new Error('This archive contains no supported images.');
      return { names: entries.map(e => e.fileName), kind: 'zip', read: i => { if (!entries[i]) throw new Error('Page does not exist.'); return zipRead(zip, entries[i]); }, close: () => zip.close() };
    } catch (e) { zip.close(); throw e; }
  }
  if (signature.subarray(0, 4).toString() === 'Rar!') {
    if (stat.size > 1.5 * 1024 ** 3) throw new Error('RAR archives above 1.5 GB are not supported. Repack as CBZ.');
    const data = await fs.readFile(file);
    const extractor = await unrar.createExtractorFromData({ data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) });
    const entries = [...extractor.getFileList().fileHeaders].filter(e => !e.flags.directory && isImage(e.name)).sort((a, b) => naturalCompare(a.name, b.name));
    if (!entries.length) throw new Error('This archive contains no supported images.');
    return {
      names: entries.map(e => e.name), kind: 'rar',
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
