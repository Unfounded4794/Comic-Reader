import path from 'node:path';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
export const DETECTOR_VERSION = 'ensemble-2';
const clamp = (v, low = 0, high = 1) => Math.max(low, Math.min(high, v));
export function intersection(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}
export function iou(a, b) { const shared = intersection(a, b); return shared / Math.max(1e-9, a.w * a.h + b.w * b.h - shared); }
export function suppressDuplicates(panels, threshold = 0.55) {
  const kept = [];
  for (const p of [...panels].sort((a, b) => b.confidence - a.confidence)) {
    if (p.w < 0.025 || p.h < 0.018 || p.w * p.h < 0.002) continue;
    // IoU, never intersection/smaller-area: nested inset panels are meaningful.
    if (!kept.some(q => iou(p, q) > threshold)) kept.push(p);
  }
  return kept.slice(0, 60);
}
export function rectangle(p) { return [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]]; }
export function validatePanels(panels) {
  if (!Array.isArray(panels) || !panels.length || panels.length > 100) throw new Error('A page must have between 1 and 100 panels.');
  return panels.map(p => {
    if (!Array.isArray(p.polygon) || p.polygon.length < 3 || p.polygon.length > 300) throw new Error('Invalid panel outline.');
    const polygon = p.polygon.map(point => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(v => !Number.isFinite(v))) throw new Error('Invalid panel point.');
      return point.map(v => clamp(v));
    });
    const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (w < 0.005 || h < 0.005) throw new Error('Panel is too small.');
    return { x, y, w, h, polygon, confidence: 1, source: 'manual' };
  });
}
async function tensorFor(bytes, size, region) {
  let pipeline = sharp(bytes, { limitInputPixels: 400000000 }).rotate();
  if (region) pipeline = pipeline.extract(region);
  const { data, info } = await pipeline.resize(size, size, { fit: 'inside' }).flatten({ background: '#fff' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const left = Math.floor((size - info.width) / 2), top = Math.floor((size - info.height) / 2);
  const plane = size * size, input = new Float32Array(3 * plane).fill(114 / 255);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const dst = (y + top) * size + x + left, src = (y * info.width + x) * info.channels;
    for (let c = 0; c < 3; c++) input[c * plane + dst] = data[src + c] / 255;
  }
  return { tensor: new ort.Tensor('float32', input, [1, 3, size, size]), left, top, width: info.width, height: info.height, size };
}
function box(x1, y1, x2, y2, confidence, prep, source) {
  const x = clamp((x1 - prep.left) / prep.width), y = clamp((y1 - prep.top) / prep.height);
  return { x, y, w: clamp((x2 - prep.left) / prep.width) - x, h: clamp((y2 - prep.top) / prep.height) - y, confidence, source };
}
function simplify(points, tolerance) {
  if (points.length <= 3) return points;
  const first = points[0], last = points.at(-1), dx = last[0] - first[0], dy = last[1] - first[1], length = dx * dx + dy * dy;
  let furthest = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const t = length ? clamp(((points[i][0] - first[0]) * dx + (points[i][1] - first[1]) * dy) / length) : 0;
    const d = Math.hypot(points[i][0] - first[0] - t * dx, points[i][1] - first[1] - t * dy);
    if (d > furthest) { furthest = d; index = i; }
  }
  if (furthest <= tolerance) return [first, last];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}
function maskPolygon(coefficients, proto, rawBox, prep) {
  const [, channels, height, width] = proto.dims, plane = width * height;
  const x0 = clamp(Math.floor(rawBox[0] / prep.size * width), 0, width - 1), y0 = clamp(Math.floor(rawBox[1] / prep.size * height), 0, height - 1);
  const x1 = clamp(Math.ceil(rawBox[2] / prep.size * width), 0, width), y1 = clamp(Math.ceil(rawBox[3] / prep.size * height), 0, height);
  const mask = new Uint8Array(plane);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = y * width + x; let logit = 0;
    for (let c = 0; c < channels; c++) logit += coefficients[c] * proto.data[c * plane + i];
    mask[i] = logit > 0 ? 1 : 0;
  }
  // Trace the exterior of the instance mask; keeps diagonal and concave borders.
  const stride = width + 1, edges = new Map();
  const add = (a, b) => { const list = edges.get(a) ?? []; list.push(b); edges.set(a, list); };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (mask[y * width + x]) {
    const a = y * stride + x;
    if (y === 0 || !mask[(y - 1) * width + x]) add(a, a + 1);
    if (x === width - 1 || !mask[y * width + x + 1]) add(a + 1, a + stride + 1);
    if (y === height - 1 || !mask[(y + 1) * width + x]) add(a + stride + 1, a + stride);
    if (x === 0 || !mask[y * width + x - 1]) add(a + stride, a);
  }
  let best = [], bestArea = 0;
  while (edges.size) {
    const start = edges.keys().next().value; let current = start; const loop = [];
    for (let guard = 0; guard < plane * 4; guard++) {
      loop.push([current % stride, Math.floor(current / stride)]);
      const next = edges.get(current); if (!next?.length) break;
      const target = next.pop(); if (!next.length) edges.delete(current); current = target;
      if (current === start) break;
    }
    const area = Math.abs(loop.reduce((sum, p, i) => { const q = loop[(i + 1) % loop.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0));
    if (area > bestArea) { best = loop; bestArea = area; }
  }
  if (best.length < 3) return null;
  const mapped = best.map(([x, y]) => [clamp((x / width * prep.size - prep.left) / prep.width), clamp((y / height * prep.size - prep.top) / prep.height)]);
  mapped.push(mapped[0]);
  const simple = simplify(mapped, 0.0025).slice(0, -1);
  return simple.length >= 3 ? simple : null;
}
export function orderFeatures(a, b, medianHeight, count) {
  const dx = b.x + b.w / 2 - a.x - a.w / 2, dy = b.y + b.h / 2 - a.y - a.h / 2;
  const vertical = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) / Math.min(a.h, b.h);
  const horizontal = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) / Math.min(a.w, b.w);
  return [dx, dy, vertical, horizontal, a.h / b.h, a.w / b.w, +(a.x + a.w / 2 < .5), +(b.x + b.w / 2 < .5), +(a.y + a.h / 2 < .5), +(b.y + b.h / 2 < .5), +(a.h > medianHeight * 1.4), +(b.h > medianHeight * 1.4), count / 20, +(vertical >= .3 && dx > 0)];
}
export class PanelDetector {
  constructor(modelDirectory) { this.directory = modelDirectory; this.sessions = new Map(); }
  async session(name) {
    if (!this.sessions.has(name)) this.sessions.set(name, ort.InferenceSession.create(path.join(this.directory, name + '.onnx'), { executionProviders: ['cpu'], intraOpNumThreads: 2, interOpNumThreads: 1, graphOptimizationLevel: 'all' }).catch(e => { this.sessions.delete(name); throw new Error(`Panel model unavailable (${name}): ${e.message}`); }));
    return this.sessions.get(name);
  }
  async boxes(bytes, threshold, size = 640, region) {
    const session = await this.session('western-panels'), prep = await tensorFor(bytes, size, region);
    const out = await session.run({ [session.inputNames[0]]: prep.tensor });
    const tensor = out[session.outputNames[0]], data = tensor.data, count = tensor.dims[2], panels = [];
    for (let i = 0; i < count; i++) if (data[4 * count + i] >= threshold) {
      const cx = data[i], cy = data[count + i], w = data[count * 2 + i], h = data[count * 3 + i];
      panels.push(box(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2, data[4 * count + i], prep, 'western'));
    }
    return suppressDuplicates(panels);
  }
  async shapes(bytes, threshold, region) {
    const session = await this.session('panel-shapes'), prep = await tensorFor(bytes, 1504, region);
    const out = await session.run({ [session.inputNames[0]]: prep.tensor });
    const data = out.output0.data, proto = out.output1, panels = [];
    for (let i = 0; i < out.output0.dims[1]; i++) {
      const offset = i * 38, confidence = data[offset + 4];
      if (confidence < threshold) continue;
      const bounds = Array.from(data.subarray(offset, offset + 4));
      const p = box(...bounds, confidence, prep, 'segmentation');
      if (p.w * p.h < .002) continue;
      p.polygon = maskPolygon(data.subarray(offset + 6, offset + 38), proto, bounds, prep) ?? rectangle(p);
      panels.push(p);
    }
    return suppressDuplicates(panels);
  }
  async order(panels, direction) {
    if (panels.length < 2) return panels;
    const session = await this.session('panel-order');
    const boxes = panels.map(p => direction === 'rtl' ? { ...p, x: 1 - p.x - p.w } : p);
    const heights = boxes.map(p => p.h).sort((a, b) => a - b), n = boxes.length;
    const median = n % 2 ? heights[Math.floor(n / 2)] : (heights[n / 2 - 1] + heights[n / 2]) / 2;
    const features = [], pairs = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) { features.push(...orderFeatures(boxes[i], boxes[j], median, n)); pairs.push(i); }
    const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', Float32Array.from(features), [pairs.length, 14]) });
    const probabilities = output.probabilities.data, scores = new Float64Array(n);
    pairs.forEach((i, row) => { scores[i] += probabilities[row * 2 + 1]; });
    return panels.map((p, i) => ({ p, score: scores[i] })).sort((a, b) => b.score - a.score).map(x => x.p);
  }
  async detect(bytes, { threshold = .45, shapes = true, direction = 'ltr' } = {}) {
    const meta = await sharp(bytes, { limitInputPixels: 400000000 }).metadata();
    const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
    // Overlapping tiles preserve small panels on long stitched webtoons.
    const regions = [];
    if (height / width > 2.8) {
      const tileHeight = Math.min(height, Math.round(width * 1.8)), step = Math.round(tileHeight * .8);
      for (let top = 0; top < height; top += step) { const y = Math.min(top, height - tileHeight); regions.push({ left: 0, top: y, width, height: tileHeight }); if (y + tileHeight === height) break; }
    } else regions.push(undefined);
    let combined = [];
    for (const region of regions) {
      const western = await this.boxes(bytes, threshold, 640, region);
      const detailed = await this.boxes(bytes, Math.max(threshold, .75), 960, region);
      // Keep the training-resolution boxes as the authority. High-resolution
      // predictions add small insets, but must not replace a reliable parent.
      let panels = [...western];
      for (const candidate of detailed) if (!panels.some(p => iou(p, candidate) > .45)) panels.push(candidate);
      if (shapes) {
        const segmented = await this.shapes(bytes, Math.max(threshold, .38), region);
        for (const shape of segmented) {
          const match = panels.map((p, i) => ({ p, i, overlap: iou(p, shape) })).sort((a, b) => b.overlap - a.overlap)[0];
          if (match?.overlap > .5) { panels[match.i] = { ...match.p, polygon: shape.polygon, source: 'ensemble' }; }
          else if (shape.confidence >= Math.max(threshold, .9) && !panels.some(p => intersection(p, shape) / Math.min(p.w * p.h, shape.w * shape.h) > .3)) panels.push(shape);
        }
      }
      for (const p of panels) {
        p.polygon ??= rectangle(p);
        if (region) {
          p.x = (region.left + p.x * region.width) / width; p.y = (region.top + p.y * region.height) / height;
          p.w *= region.width / width; p.h *= region.height / height;
          p.polygon = p.polygon.map(([x, y]) => [(region.left + x * region.width) / width, (region.top + y * region.height) / height]);
        }
      }
      combined.push(...panels);
    }
    combined = suppressDuplicates(combined);
    const fallback = combined.length <= 1;
    if (fallback) combined = [{ x: 0, y: 0, w: 1, h: 1, polygon: [[0, 0], [1, 0], [1, 1], [0, 1]], confidence: 0, source: 'whole-page' }];
    const ordered = regions.length > 1 ? combined.sort((a, b) => a.y - b.y || a.x - b.x) : await this.order(combined, direction);
    return { width, height, panels: ordered, fallback, version: DETECTOR_VERSION, manual: false };
  }
}
