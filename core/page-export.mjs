import fs from 'node:fs/promises';
import path from 'node:path';

function safeName(value, fallback) {
  const name = String(value).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 180);
  return !name || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `${fallback}${path.extname(name)}` : name;
}

// Export the archive entry itself, without decoding, rotating, or recompressing it.
export async function saveOriginalPage({ folder, title, name, bytes }) {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Choose a saved pages folder in Preferences first.');
  if (!(await fs.stat(folder)).isDirectory()) throw new Error('The saved pages folder is not a directory.');
  const directory = path.join(folder, safeName(title, 'Comic'));
  await fs.mkdir(directory, { recursive: true });
  const original = safeName(String(name).split(/[\\/]/).at(-1), 'Page');
  const extension = path.extname(original), stem = original.slice(0, original.length - extension.length);
  const content = Buffer.from(bytes);
  for (let number = 1; number <= 10000; number++) {
    const target = path.join(directory, number === 1 ? original : `${stem} (${number})${extension}`);
    let handle;
    try { handle = await fs.open(target, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await fs.stat(target);
      if (existing.isFile() && existing.size === content.length && (await fs.readFile(target)).equals(content)) return { path: target, alreadySaved: true };
      continue;
    }
    try { await handle.writeFile(content); }
    catch (error) { await handle.close(); await fs.unlink(target).catch(() => {}); throw error; }
    await handle.close();
    return { path: target, alreadySaved: false };
  }
  throw new Error('Too many files with the same page name in the saved pages folder.');
}
