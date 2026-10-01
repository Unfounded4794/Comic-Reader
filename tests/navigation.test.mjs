import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentComic, folderTree, homeBooks, homeCollections, seriesContinuations } from '../core/catalog.mjs';
import { spatialTarget } from '../core/navigation.mjs';
import { boxPolygon, panelCoverage, protectBubbles } from '../core/panel-geometry.mjs';
import { validatePanels } from '../core/panels.mjs';

test('Home exposes children, leaf/empty roots, and books alongside expanded roots', () => {
  const books = [{ id: '1', root: '/library', relativeDir: 'Series' }, { id: '2', root: '/library', relativeDir: '' }, { id: '3', root: '/leaf', relativeDir: '' }, { id: '4' }];
  const trees = folderTree(['/library', '/leaf', '/empty'], books);
  assert.deepEqual(homeCollections(trees).map(node => node.name), ['Series', 'leaf', 'empty']);
  assert.deepEqual(homeBooks(trees, books).map(book => book.id), ['2', '4']);
});
test('continuations retain at least ten available series in recency order', () => {
  const books = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `Issue ${i}`, folder: `/series${i}`, lastRead: i + 1, pageCount: 3, progress: { page: 1 } }));
  assert.deepEqual(seriesContinuations(books).slice(0, 10).map(item => item.next.id), ['11', '10', '9', '8', '7', '6', '5', '4', '3', '2']);
});
test('previous/next issues use natural order, skip missing books, and stay in their folder', () => {
  const books = ['15', '2', '14'].map(id => ({ id, title: `Issue ${id}`, folder: '/series' }));
  books.push({ id: '13', title: 'Issue 13', folder: '/series', missing: true }, { id: 'other', title: 'Issue 16', folder: '/other' });
  assert.equal(adjacentComic(books, books[0], -1).id, '14');
  assert.equal(adjacentComic(books, books[2], 1).id, '15');
  assert.equal(adjacentComic(books, books[1], -1), null);
  assert.equal(adjacentComic(books, books[3], 1), null);
  assert.equal(adjacentComic(books, books[4], -1), null);
});
const rect = (left, top, width = 100, height = 40) => ({ left, top, right: left + width, bottom: top + height });
test('spatial arrows prefer the visible row and column over nearer diagonal controls', () => {
  const from = rect(0, 100);
  const edit = { id: 'edit', rect: rect(110, 300, 20) }, collection = { id: 'collection', rect: rect(300, 100, 150) };
  assert.equal(spatialTarget(from, [edit, collection], 'ArrowRight').id, 'collection');
  const below = { id: 'below', rect: rect(0, 240) }, diagonal = { id: 'diagonal', rect: rect(120, 145) };
  assert.equal(spatialTarget(from, [diagonal, below], 'ArrowDown').id, 'below');
  assert.equal(spatialTarget(from, [collection, below], 'ArrowLeft'), null);
  assert.equal(spatialTarget(from, [{ id: 'in-row', rect: rect(2, 160) }], 'ArrowRight'), null);
});
const panel = (x, y, w, h) => ({ x, y, w, h, polygon: boxPolygon({ x, y, w, h }) });
test('a crossing bubble belongs to the panel containing most of it and expands its complete frame', () => {
  const panels = [panel(0, 0, .5, 1), panel(.5, 0, .5, 1)];
  const result = protectBubbles(panels, [{ x: .44, y: .3, w: .25, h: .2 }]);
  assert.equal(result[0].protectedRegions.length, 0);
  assert.equal(result[1].protectedRegions.length, 1);
  assert.ok(result[1].x < .44);
  assert.ok(result[1].x + result[1].w >= .99);
  assert.equal(panels[1].x, .5);
});
test('dialogue inside an inset is assigned there, without growing the surrounding panel', () => {
  const result = protectBubbles([panel(0, 0, 1, 1), panel(.2, .2, .3, .3)], [{ x: .25, y: .25, w: .1, h: .1 }]);
  assert.equal(result[0].protectedRegions.length, 0);
  assert.equal(result[1].protectedRegions.length, 1);
});
test('saving or reordering detected outlines preserves their protected dialogue', () => {
  const detected = protectBubbles([panel(0, 0, .5, .5), panel(.5, .5, .5, .5)], [{ x: .4, y: .1, w: .2, h: .2 }]);
  const saved = validatePanels([...detected].reverse());
  assert.deepEqual(saved[1].protectedRegions, detected[0].protectedRegions);
  assert.equal(saved[1].w, detected[0].w);
  assert.throws(() => validatePanels([{ ...detected[0], protectedRegions: [{ x: NaN, y: 0, w: 1, h: 1 }] }]), /Invalid dialogue/);
});
test('coverage measures visible polygon union rather than overlapping bounding boxes', () => {
  const panels = [panel(0, 0, .5, 1), panel(0, 0, .5, 1)];
  assert.equal(panelCoverage(panels), .5);
  const triangle = { ...panel(0, 0, 1, 1), polygon: [[0, 0], [1, 0], [0, 1]] };
  assert.ok(Math.abs(panelCoverage([triangle]) - .5) < .01);
});
