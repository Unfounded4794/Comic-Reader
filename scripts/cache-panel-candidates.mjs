import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { openArchive } from '../core/archive.mjs';
import { PanelDetector } from '../core/panels.mjs';
import samples from './sample-files.mjs';
const output = process.env.PANEL_READER_SAMPLE_OUTPUT || 'validation/candidates';
await fs.mkdir(output, { recursive: true });
const detector = new PanelDetector(path.resolve('models'));
for (const [b, file] of samples.entries()) {
  const archive = await openArchive(file), results = [];
  try {
    for (let page = 0; page < archive.names.length; page++) {
      const stem = `${b + 1}-${page + 1}`, location = path.join(output, stem + '.json');
      try { results.push(JSON.parse(await fs.readFile(location, 'utf8'))); continue; } catch {}
      const bytes = await archive.read(page), meta = await sharp(bytes).metadata();
      const result = { file, book: b + 1, page: page + 1, width: meta.width, height: meta.height,
        western: await detector.boxes(bytes, .2), detailed: await detector.boxes(bytes, .3, 960),
        segmented: await detector.shapes(bytes, .25), bubbles: await detector.bubbles(bytes) };
      await sharp(bytes).rotate().resize({ width: 800 }).png().toFile(path.join(output, stem + '.png'));
      await fs.writeFile(location, JSON.stringify(result)); results.push(result);
      console.log(`${b + 1}: ${page + 1}/${archive.names.length}`);
    }
  } finally { archive.close(); }
  await fs.writeFile(path.join(output, `book-${b + 1}.json`), JSON.stringify(results));
}
