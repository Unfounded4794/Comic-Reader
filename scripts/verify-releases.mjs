import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { list } from 'tar';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const models = JSON.parse(await fs.readFile('models/manifest.json', 'utf8'));
async function sourceFiles(folder) {
  const files = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(file)); else files.push(file.replaceAll('\\', '/'));
  }
  return files;
}
const code = [...await sourceFiles('core'), ...await sourceFiles('electron'), ...await sourceFiles('dist')];
const reports = [];
for (const [folder, platform] of [['win-unpacked', 'win32'], ['linux-unpacked', 'linux']]) {
  const root = path.resolve('release', folder), resources = path.join(root, 'resources'), archive = path.join(resources, 'app.asar');
  const entries = asar.listPackage(archive).map(p => p.replaceAll('\\','/'));
  if (entries.some(p => /\/validation\/|\.cb[rz]$/i.test(p))) throw new Error('Private sample content found in package.');
  for (const file of code) if (sha(asar.extractFile(archive, path.normalize(file))) !== sha(await fs.readFile(file))) throw new Error(`Stale packaged code: ${folder}/${file}`);
  for (const model of models) if (sha(await fs.readFile(path.join(resources, 'models', model.file))) !== model.sha256) throw new Error(`Model checksum mismatch: ${folder}/${model.file}`);
  const native = path.join(resources, 'app.asar.unpacked', 'node_modules');
  await fs.access(path.join(native, 'onnxruntime-node', 'bin', 'napi-v6', platform, 'x64', 'onnxruntime_binding.node'));
  await fs.access(path.join(native, '@img', `sharp-${platform}-x64`));
  if (platform === 'linux') {
    await fs.access(path.join(native, '@img', 'sharp-libvips-linux-x64'));
    const binary = await fs.readFile(path.join(root,'panel-reader'));
    if (!binary.subarray(0,4).equals(Buffer.from([127,69,76,70])) || binary.readUInt16LE(18) !== 62) throw new Error('Linux executable is not ELF x86-64.');
  }
  reports.push({ platform, applicationFilesMatched: code.length, modelsVerified: models.length, nativeLibrariesPresent: true });
}
const modes = {};
await list({ file: `release/Panel-Reader-${pkg.version}-Linux-x64.tar.gz`, strict: true, onReadEntry(entry) {
  const name = path.posix.basename(entry.path);
  if (['panel-reader','chrome-sandbox','chrome_crashpad_handler'].includes(name)) {
    if (!(entry.mode & 0o111)) throw new Error(`Not executable: ${name}`);
    modes[name] = entry.mode.toString(8);
  }
} });
if (Object.keys(modes).length !== 3) throw new Error('Linux tar is missing executables.');
const checksums = [];
for (const name of await fs.readdir('release')) if (/\.(exe|tar\.gz|zip)$/.test(name)) checksums.push(`${sha(await fs.readFile(path.join('release',name)))}  ${name}`);
await fs.writeFile('release/SHA256SUMS.txt', checksums.join('\n') + '\n');
await fs.writeFile('validation/release-report.json', JSON.stringify({ reports, modes }, null, 2));
console.log(JSON.stringify({ reports, modes }, null, 2));
