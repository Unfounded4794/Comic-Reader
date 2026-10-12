import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveOriginalPage } from '../core/page-export.mjs';
import { normalizeSettings } from '../core/settings.mjs';

test('page exports retain original bytes and filenames, deduplicate repeats, and preserve conflicting files', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-export-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const args = { folder, title: 'Issue 01', name: 'nested/pages/008.JPG', bytes: Buffer.from([0xff, 0xd8, 0x00, 0x42, 0xff, 0xd9]) };
  const first = await saveOriginalPage(args);
  assert.equal(first.path, path.join(folder, 'Issue 01', '008.JPG'));
  assert.deepEqual(await fs.readFile(first.path), args.bytes);
  assert.equal((await saveOriginalPage(args)).alreadySaved, true);
  const other = await saveOriginalPage({ ...args, bytes: Buffer.from('different image') });
  assert.equal(other.path, path.join(folder, 'Issue 01', '008 (2).JPG'));
  assert.deepEqual(await fs.readFile(first.path), args.bytes);
  assert.equal((await saveOriginalPage({ ...args, bytes: Buffer.from('different image') })).alreadySaved, true);
});

test('export names remain inside the chosen folder and invalid Windows names are sanitized', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'reader-export-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  for (const [title, name] of [['../outside', '../../CON.png'], ['..', '..\\NUL.jpg'], ['Issue: 2?', 'pages/001.png']]) {
    const result = await saveOriginalPage({ folder, title, name, bytes: Buffer.from(name) });
    assert.ok(!path.relative(folder, result.path).startsWith('..' + path.sep));
    assert.ok(!/[<>:"|?*]/.test(path.relative(folder, result.path)));
    assert.deepEqual(await fs.readFile(result.path), Buffer.from(name));
  }
  await assert.rejects(saveOriginalPage({ folder: '', title: 'Issue', name: '01.png', bytes: [] }), /Choose a saved pages folder/);
});

test('saved page preferences and both shortcuts persist through normalization', () => {
  const folder = path.resolve('saved pages');
  const settings = normalizeSettings({ savePageFolder: folder, shortcuts: { savePage: 'Ctrl+Alt+S', favorite: 'F9' } });
  assert.equal(settings.savePageFolder, folder);
  assert.equal(settings.shortcuts.savePage, 'Ctrl+Alt+S');
  assert.equal(settings.shortcuts.favorite, 'F9');
  assert.equal(normalizeSettings({ savePageFolder: 'bad\0path' }).savePageFolder, '');
});
