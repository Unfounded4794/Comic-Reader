import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { openArchive } from '../core/archive.mjs';
import { PanelDetector } from '../core/panels.mjs';
import sampleFiles from './sample-files.mjs';
const detector = new PanelDetector(path.resolve('models'));
const output = process.env.PANEL_READER_SAMPLE_OUTPUT || 'validation';
await fs.mkdir(output, { recursive: true });
const report = [];
for (const [bookIndex, file] of sampleFiles.entries()) {
  console.log(`Opening ${path.basename(file)}`);
  const archive = await openArchive(file), book = { file, kind: archive.kind, pages: archive.names.length, results: [] };
  const thumbs = [];
  for (let i = 0; i < archive.names.length; i++) {
    const start = performance.now();
    try {
      const bytes = await archive.read(i);
      // Full raster decode, not merely a successful archive listing.
      const preview = await sharp(bytes, { limitInputPixels: 400000000 }).rotate().resize(420, 600, { fit: 'contain', background: '#181b20' }).png().toBuffer();
      const result = await detector.detect(bytes);
      if (result.panels.some(p => p.source === 'page-context')) throw new Error('Overview substituted for region recovery.');
      if (result.panels.length > 1 && result.panels.some(p => p.source === 'whole-page')) throw new Error('Whole-page fallback mixed with close-ups.');
      if (result.coverage.some(c => c.artwork < .9)) throw new Error(`More than 10% artwork omitted: ${JSON.stringify(result.coverage)}`);
      book.results.push({ page: i + 1, name: archive.names[i], milliseconds: Math.round(performance.now() - start), ...result });
      const scale = Math.min(420 / result.width, 600 / result.height), w = result.width * scale, h = result.height * scale, left = (420 - w) / 2, top = (600 - h) / 2;
      const svg = `<svg width="420" height="630"><rect y="600" width="420" height="30" fill="#181b20"/><text x="8" y="620" fill="white" font-size="15">Page ${i + 1} · ${result.panels.length} panels${result.fallback ? ' (whole page)' : ''}</text>${result.panels.map((p, n) => `<polygon points="${p.polygon.map(([x, y]) => `${left + x * w},${top + y * h}`).join(' ')}" fill="none" stroke="#00ff88" stroke-width="2"/><rect x="${left + p.x * w}" y="${top + p.y * h}" width="23" height="23" fill="#00ff88"/><text x="${left + p.x * w + 4}" y="${top + p.y * h + 18}" fill="black" font-size="18">${n + 1}</text>`).join('')}</svg>`;
      const thumb = await sharp({ create: { width: 420, height: 630, channels: 3, background: '#181b20' } }).composite([{ input: preview, left: 0, top: 0 }, { input: Buffer.from(svg), left: 0, top: 0 }]).png().toBuffer();
      thumbs.push(thumb);
      if ([2, 5, 9, 13, 17].includes(i)) await fs.writeFile(`${output}/book-${bookIndex + 1}-page-${i + 1}.jpg`, await sharp(bytes).rotate().resize({ width: 1300 }).jpeg({ quality: 90 }).toBuffer());
      console.log(`  ${i + 1}/${archive.names.length}: ${result.panels.length} panels, ${Math.round(performance.now() - start)} ms`);
    } catch (e) { book.results.push({ page: i + 1, error: e.message }); console.error(`  Page ${i + 1}: ${e.message}`); }
  }
  for (let start = 0; start < thumbs.length; start += 8) {
    const chunk = thumbs.slice(start, start + 8), rows = Math.ceil(chunk.length / 4);
    await sharp({ create: { width: 1680, height: rows * 630, channels: 3, background: '#181b20' } }).composite(chunk.map((input, i) => ({ input, left: i % 4 * 420, top: Math.floor(i / 4) * 630 }))).jpeg({ quality: 90 }).toFile(`${output}/book-${bookIndex + 1}-sheet-${Math.floor(start / 8) + 1}.jpg`);
  }
  archive.close(); report.push(book);
  await fs.writeFile(`${output}/sample-report.json`, JSON.stringify(report, null, 2));
}
const errors = report.flatMap(b => b.results.filter(r => r.error));
const summary = report.map(b => {
  const valid = b.results.filter(r => !r.error), coverage = valid.flatMap(r => r.coverage);
  return { book: path.basename(b.file), pages: b.pages, errors: b.results.length - valid.length, wholePages: valid.filter(r => r.fallback).length, minimumPageCoverage: Math.min(...coverage.map(c => c.page)), minimumArtworkCoverage: Math.min(...coverage.map(c => c.artwork)), recoveredRegions: coverage.reduce((n, c) => n + c.recovered, 0) };
});
await fs.writeFile(`${output}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
console.log(JSON.stringify({ books: report.length, pages: report.reduce((sum, b) => sum + b.pages, 0), errors: errors.length }));
if (errors.length) process.exitCode = 1;
