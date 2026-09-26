import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = path.resolve('models');
await mkdir(root, { recursive: true });
const models = [
  { file: 'western-panels.onnx', repo: 'cedarrapidsboy/inkwell-panel-models', revision: 'fa7afba', remote: 'best.onnx', license: 'AGPL-3.0' },
  { file: 'panel-order.onnx', repo: 'cedarrapidsboy/inkwell-panel-models', revision: 'fa7afba', remote: 'panel-order-model.onnx', license: 'MIT' },
  { file: 'panel-shapes.onnx', repo: 'Remidesbois/Poneglyph-ReaderNet', revision: 'd97d4cd', remote: 'panel_detector.onnx', license: 'AGPL-3.0' },
];
let lock = [];
try { lock = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); } catch {}
for (const model of models) {
  const url = `https://huggingface.co/${model.repo}/resolve/${model.revision}/${model.remote}`;
  const expected = lock.find(m => m.file === model.file)?.sha256;
  let bytes;
  try { bytes = await readFile(path.join(root, model.file)); } catch {}
  if (!bytes || (expected && createHash('sha256').update(bytes).digest('hex') !== expected)) {
    console.log(`Downloading ${model.file}…`);
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (expected && sha256 !== expected) throw new Error(`Checksum mismatch: ${model.file}`);
  await writeFile(path.join(root, model.file), bytes);
  Object.assign(model, { url, sha256, bytes: bytes.length });
  console.log(`${model.file}: ${bytes.length} bytes, ${sha256}`);
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(models, null, 2) + '\n');
// Preserve the model authors' documentation alongside the weights.
for (const [file, repo, revision, remote] of [
  ['WESTERN_MODEL.md', models[0].repo, models[0].revision, 'README.md'],
  ['SHAPE_MODEL.md', models[2].repo, models[2].revision, 'README.md'],
  ['reference-order.py', models[0].repo, models[0].revision, 'detect_and_order.py'],
  ['shape-contract.json', models[2].repo, models[2].revision, 'model_manifest.json'],
]) {
  const response = await fetch(`https://huggingface.co/${repo}/resolve/${revision}/${remote}`);
  if (!response.ok) throw new Error(`Could not download ${file}`);
  await writeFile(path.join(root, file), await response.text());
}
