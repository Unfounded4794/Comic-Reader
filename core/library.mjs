import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { COMIC_RE, IMAGE_RE, naturalCompare } from './archive.mjs';
export const bookId = file => createHash('sha256').update(process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)).digest('hex').slice(0, 24);
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
export async function scanFolders(folders, previous = []) {
  const old = new Map(previous.map(b => [b.id, b]));
  const books = new Map(); const errors = [];
  async function walk(folder, root) {
    const visited = rootVisited.get(pathKey(root));
    let canonical, entries;
    try {
      canonical = await fs.realpath(folder);
      const canonicalKey = pathKey(canonical);
      if (visited.has(canonicalKey)) return;
      visited.add(canonicalKey);
      entries = await fs.readdir(folder, { withFileTypes: true });
    } catch (e) { errors.push({ path: folder, message: e.message }); return; }
    for (const entry of entries) {
      const file = path.join(folder, entry.name);
      let directory = entry.isDirectory(), regular = entry.isFile();
      if (entry.isSymbolicLink()) {
        try { const stat = await fs.stat(file); directory = stat.isDirectory(); regular = stat.isFile(); }
        catch (e) { errors.push({ path: file, message: e.message }); continue; }
      }
      if (directory) { await walk(file, root); continue; }
      // Standalone images can be complete long-form webtoon episodes, not just
      // pages inside an archive. They are first-class books everywhere else in
      // the app, so library scans need to discover them too.
      if (!regular || (!COMIC_RE.test(entry.name) && !IMAGE_RE.test(entry.name))) continue;
      try {
        const stat = await fs.stat(file); const id = bookId(file); const before = old.get(id);
        if (books.has(id)) continue;
        const relativeDir = path.relative(root, path.dirname(file));
        books.set(id, { ...before, id, path: file, root, folder: path.dirname(file), relativeDir, source: 'library', title: path.basename(file, path.extname(file)), format: path.extname(file).slice(1).toUpperCase(), size: stat.size, modified: stat.mtimeMs, added: before?.added ?? Date.now(), isNew: before ? before.isNew : true, missing: false });
      } catch (e) { errors.push({ path: file, message: e.message }); }
    }
  }
  // Scan the most-specific roots first. If watched roots overlap, a comic belongs
  // to the closest root while the parent root still discovers all other children.
  const roots = [...new Map(folders.map(folder => [pathKey(folder), path.resolve(folder)])).values()].sort((a, b) => b.length - a.length);
  const rootVisited = new Map(roots.map(root => [pathKey(root), new Set()]));
  for (const folder of roots) await walk(folder, folder);
  // Keep history for disconnected drives and files opened outside the library.
  for (const before of previous) if (!books.has(before.id)) {
    if (before.root && !roots.some(root => pathKey(root) === pathKey(before.root))) continue;
    let missing = true;
    try { await fs.access(before.path); missing = false; } catch {}
    books.set(before.id, { ...before, missing });
  }
  return { books: [...books.values()].sort((a, b) => naturalCompare(a.title, b.title)), added: [...books.keys()].filter(id => !old.has(id)).length, errors };
}
