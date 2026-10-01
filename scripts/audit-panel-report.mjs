import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const folder = process.env.PANEL_READER_SAMPLE_OUTPUT || 'validation/region-recovery';
const books = JSON.parse(await fs.readFile(`${folder}/sample-report.json`, 'utf8'));
assert.equal(books.length, 5);
assert.equal(books.reduce((n, b) => n + b.pages, 0), 139);
for (const book of books) for (const page of book.results) {
  const label = `${book.file}, page ${page.page}`;
  assert.ok(!page.error, `${label}: ${page.error}`);
  assert.ok(page.coverage.every(c => c.page >= .9 && c.artwork >= .97), `${label}: insufficient visible coverage`);
  assert.ok(page.panels.every(p => p.source !== 'page-context'), `${label}: overview workaround returned`);
  if (page.panels.length > 1) assert.ok(page.panels.every(p => p.source !== 'whole-page' && p.w * p.h < .98), `${label}: full-page stop mixed with close-ups`);
}
// Manually reviewed simple layouts guard against false positives as well as
// coverage loss. These are archive page numbers, including covers and ads.
const cases = [
  ['Chapter_1', 10, 4, 'four conventional panels'],
  ['Chapter_295', 1, 1, 'chapter illustration, not cropped fragments'],
  ['Superman 006', 10, 2, 'large background plus bottom inset'],
  ['Superman 006', 19, 3, 'window scene plus two lower strips'],
  ['Superman 015', 8, 8, 'independent top panels retained'],
  ['Superman 015', 9, 3, 'right-hand Aquaman region recovered'],
  ['Superman 015', 14, 5, 'table scene is one panel, not cropped fragments'],
  ['Young Justice', 5, 10, 'seven portrait panels plus three story panels'],
  ['Young Justice', 13, 3, 'comics pictured in the artwork are not panels'],
  ['Young Justice', 17, 7, 'seven panels; clock is not an eighth'],
];
for (const [name, number, count, reason] of cases) {
  const book = books.find(b => b.file.includes(name));
  assert.ok(book, `Missing book: ${name}`);
  assert.equal(book.results[number - 1].panels.length, count, `${name}, page ${number}: ${reason}`);
}
console.log(`PASS: all 139 pages exceed 90% page / 97% artwork coverage; no overview stops; ${cases.length} reviewed layout regressions.`);
