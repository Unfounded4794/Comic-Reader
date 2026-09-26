import fs from 'node:fs/promises';
import path from 'node:path';
import { create, list } from 'tar';

const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const source = path.resolve('release/linux-unpacked');
const artifact = `Panel-Reader-${pkg.version}-Linux-x64`;
const target = path.resolve('release', `${artifact}.tar.gz`);
const temporary = target + '.pending';
const executables = new Set(['panel-reader', 'chrome-sandbox', 'chrome_crashpad_handler']);
for (const name of executables) await fs.access(path.join(source, name));

// Windows filesystems do not preserve Unix executable bits. Set them in the
// archive headers, so a normal tar extraction produces a runnable Linux app.
await create({
  cwd: source, file: temporary, gzip: { level: 6 }, portable: true,
  prefix: artifact,
  onWriteEntry(entry) {
    if (entry.type === 'Directory' || executables.has(path.basename(entry.path)) || /\.(so(?:\.\d+)*|node)$/.test(entry.path)) entry.stat.mode = 0o755;
    else entry.stat.mode = 0o644;
  },
}, await fs.readdir(source));

const found = new Set();
await list({ file: temporary, strict: true, onReadEntry(entry) {
  const name = entry.path.slice(artifact.length + 1);
  if (executables.has(name)) {
    if ((entry.mode & 0o111) !== 0o111) throw new Error(`Missing executable permissions: ${name}`);
    found.add(name);
  }
} });
if (found.size !== executables.size) throw new Error('Linux archive is missing a required executable.');
await fs.rename(temporary, target);
console.log(`Created ${target}; verified all three executable modes.`);
