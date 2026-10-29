import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { COMIC_RE, IMAGE_RE, naturalCompare } from './archive.mjs';
import { abortable, checkAbort, limitConcurrency } from './io.mjs';
export const bookId = file => createHash('sha256').update(process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file)).digest('hex').slice(0, 24);
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
export async function scanFolders(folders, previous = [], { signal, onProgress = () => {}, onBatch = () => {}, concurrency = 4, io = fs } = {}) {
  const old = new Map(previous.map(b => [b.id, b])), books = new Map(), errors = [], batch = [];
  const limited = limitConcurrency(concurrency), request = fn => limited(fn, signal);
  const progress = { foldersDone: 0, foldersFound: 0, filesFound: 0, added: 0, currentFolder: '' };
  let published = 0, finished = false;
  function publish() {
    if (finished) return;
    if (batch.length) onBatch(batch.splice(0));
    onProgress({ ...progress }); published = Date.now();
  }
  const timer = setInterval(publish, 150);
  async function walk({ folder, root, canonical }, visited, queue) {
    checkAbort(signal); progress.currentFolder = folder;
    try {
      canonical ??= await request(() => io.realpath(folder)); checkAbort(signal);
      const key = pathKey(canonical); if (visited.has(key)) return; visited.add(key);
      const entries = await request(() => io.readdir(folder, { withFileTypes: true })); checkAbort(signal);
      await Promise.all(entries.map(async entry => {
        checkAbort(signal);
        const file = path.join(folder, entry.name);
        let directory = entry.isDirectory(), regular = entry.isFile(), stat;
        if (entry.isSymbolicLink()) {
          try { stat = await request(() => io.stat(file)); checkAbort(signal); directory = stat.isDirectory(); regular = stat.isFile(); }
          catch (error) { if (signal?.aborted) throw error; errors.push({ path: file, message: error.message }); return; }
        }
        if (directory) {
          if (entry.name === '.panel-reader-progress') return;
          queue.push({ folder: file, root, canonical: entry.isSymbolicLink() ? undefined : path.join(canonical, entry.name) }); progress.foldersFound++; return;
        }
        if (!regular || (!COMIC_RE.test(entry.name) && !IMAGE_RE.test(entry.name))) return;
        const id = bookId(file); if (books.has(id)) return;
        try {
          stat ??= await request(() => io.stat(file)); checkAbort(signal);
          const before = old.get(id), book = { ...before, id, path: file, root, folder, relativeDir: path.relative(root, folder), source: 'library', title: path.basename(file, path.extname(file)), format: path.extname(file).slice(1).toUpperCase(), size: stat.size, modified: stat.mtimeMs, added: before?.added ?? Date.now(), isNew: before ? before.isNew : true, missing: false };
          books.set(id, book); batch.push(book); progress.filesFound++; if (!before) progress.added++;
          if ((batch.length >= 24 && Date.now() - published >= 50) || Date.now() - published >= 120) publish();
        } catch (error) { if (signal?.aborted) throw error; errors.push({ path: file, message: error.message }); }
      }));
    } catch (error) { if (signal?.aborted) throw error; errors.push({ path: folder, message: error.message }); }
    finally { progress.foldersDone++; }
  }
  const roots = [...new Map(folders.map(folder => [pathKey(folder), path.resolve(folder)])).values()].sort((a, b) => b.length - a.length);
  const work = (async () => {
    for (const root of roots) {
      const queue = [{ folder: root, root }], visited = new Set(); progress.foldersFound++;
      while (queue.length) {
        checkAbort(signal);
        await Promise.all(queue.splice(0, concurrency).map(job => walk(job, visited, queue)));
      }
    }
  })();
  let cancelled = false;
  try { publish(); await abortable(work, signal); }
  catch (error) { if (error.name !== 'AbortError') throw error; cancelled = true; }
  finally { clearInterval(timer); publish(); finished = true; }
  for (const before of previous) if (!books.has(before.id)) {
    if (before.root && !roots.some(root => pathKey(root) === pathKey(before.root))) continue;
    books.set(before.id, { ...before, missing: cancelled || !before.root ? !!before.missing : true });
  }
  return { books: [...books.values()].sort((a, b) => naturalCompare(a.title, b.title)), added: progress.added, errors, cancelled, ...progress };
}
