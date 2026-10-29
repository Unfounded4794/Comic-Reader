import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
// Retain the existing cache key so upgrading reuses previously generated covers
// and manual panel layouts instead of downloading their source archives again.
export const mediaKey = (file, source) => createHash('sha256').update(`${file}:${source.size}-${source.modified}`).digest('hex');
export const coverPath = (cache, file, source) => path.join(cache, `${mediaKey(file, source)}-cover.jpg`);
export async function writeCache(file, bytes) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await fs.writeFile(temporary, bytes, { flag: 'wx' }); await fs.rename(temporary, file); }
  catch { /* Caching must not prevent a page from opening. */ }
  finally { await fs.unlink(temporary).catch(() => {}); }
}
