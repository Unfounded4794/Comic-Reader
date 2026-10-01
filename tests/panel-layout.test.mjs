import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { boxPolygon } from '../core/panel-geometry.mjs';
import { pageRaster, fusePanels, recoverLayout, layoutCoverage } from '../core/panel-layout.mjs';
const panel = (x, y, w, h, confidence = .95, source = 'western') => ({ x, y, w, h, confidence, source, polygon: boxPolygon({ x, y, w, h }) });
const raster = await pageRaster(await sharp({ create: { width: 400, height: 600, channels: 3, background: '#49647e' } }).png().toBuffer());

test('a missing large top panel is recovered locally, without an overview or loss of lower panels', () => {
  const result = recoverLayout([panel(0, .6, .5, .4), panel(.5, .6, .5, .4)], [], raster);
  assert.equal(result.panels.length, 3);
  assert.equal(result.recovered, 1);
  assert.ok(result.panels.some(p => p.y === 0 && p.h < .65 && p.w === 1));
  assert.ok(result.panels.every(p => p.w * p.h < .7 && p.source !== 'page-context'));
  assert.ok(layoutCoverage(result.panels, raster).artwork > .99);
});

test('clipped coloured margins extend neighbouring panels without creating reading stops', () => {
  const result = recoverLayout([panel(.04, .02, .9, .46), panel(.04, .52, .9, .45)], [], raster);
  assert.equal(result.panels.length, 2);
  assert.ok(layoutCoverage(result.panels, raster).page > .99);
});

test('inconsistent shape bounds cannot swallow two distinct confident panels', () => {
  const western = [panel(0, 0, 1, .3), panel(0, .32, 1, .3), panel(0, .65, 1, .35)];
  const result = fusePanels(western, [], [panel(0, .25, 1, .75, .88, 'segmentation')], [], raster);
  assert.equal(result.length, 3);
  assert.ok(result.every(p => p.h <= .35));
});

test('high-resolution comic covers and clocks inside artwork do not become panels', () => {
  const western = [panel(0, 0, .5, .4), panel(.5, 0, .5, .4), panel(0, .4, 1, .6)];
  const result = fusePanels(western, [panel(.1, .5, .2, .2, .99), panel(.82, .02, .1, .08, .95)], [], [], raster);
  assert.equal(result.length, 3);
});

test('a high-resolution panel in a genuinely uncovered area is retained', () => {
  const result = fusePanels([panel(0, .3, 1, .7)], [panel(0, 0, .5, .28, .75), panel(.5, 0, .5, .28, .8)], [], [], raster);
  assert.equal(result.length, 3);
});

test('native confident insets remain distinct even inside a surrounding illustration', () => {
  const result = fusePanels([panel(0, 0, 1, .8), panel(.05, .05, .3, .2)], [], [], [], raster);
  assert.equal(result.length, 2);
});

test('a continuous illustration gets exactly one full-page stop', () => {
  const fused = fusePanels([], [], [panel(.05, .3, .9, .6, .92, 'segmentation')], [], raster);
  const result = recoverLayout(fused, [], raster);
  assert.equal(result.panels.length, 1);
  assert.equal(result.fallback, true);
  assert.equal(layoutCoverage(result.panels, raster).page, 1);
});
