import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { COMIC_RE, naturalCompare } from './archive.mjs';
export const bookId = file => createHash('sha256').update(process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)).digest('hex').slice(0, 24);
export async function scanFolders(folders, previous = []) {
  const old = new Map(previous.map(b => [b.id, b]));
  const books = new Map(); const errors = []; const visited = new Set();
  async function walk(folder, root) {
    let canonical, entries;
    try {
      canonical = await fs.realpath(folder);
      if (visited.has(canonical)) return;
      visited.add(canonical);
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch (e) { errors.push({ path: folder, message: e.message }); return; }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) { await walk(file, root); continue; }
      if (!entry.isFile() || !COMIC_RE.test(entry.name)) continue;
      try {
        const stat = await fs.stat(file); const id = bookId(file); const before = old.get(id);
        books.set(id, { ...before, id, path: file, root, title: path.basename(file, path.extname(file)), format: path.extname(file).slice(1).toUpperCase(), size: stat.size, modified: stat.mtimeMs, added: before?.added ?? Date.now(), isNew: before ? before.isNew : true, missing: false });
      } catch (e) { errors.push({ path: file, message: e.message }); }
    }
  }
  for (const folder of folders) await walk(folder, folder);
  // Keep history for disconnected drives and files opened outside the library.
  for (const before of previous) if (!books.has(before.id)) {
    let missing = true;
    try { await fs.access(before.path); missing = false; } catch {}
    books.set(before.id, { ...before, missing });
  }
  return { books: [...books.values()].sort((a, b) => naturalCompare(a.title, b.title)), added: [...books.keys()].filter(id => !old.has(id)).length, errors };
}
