import sharp from 'sharp';
import { boxPolygon, coverageMask, polygonBounds, protectBubbles } from './panel-geometry.mjs';

const area = p => p.w * p.h;
const shared = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const iou = (a, b) => shared(a, b) / Math.max(1e-9, area(a) + area(b) - shared(a, b));
const frame = p => ({ ...p, polygon: boxPolygon(p) });
const union = (a, b) => polygonBounds([...boxPolygon(a), ...boxPolygon(b)]);

export async function pageRaster(bytes, region) {
  let pipeline = sharp(bytes, { limitInputPixels: 400000000 }).rotate();
  if (region) pipeline = pipeline.extract(region);
  const { data, info } = await pipeline.resize({ width: 512, height: 768, fit: 'inside' }).flatten({ background: '#fff' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info, ink = new Uint8Array(width * height);
  const tone = (x, y) => {
    const i = (y * width + x) * channels;
    return (data[i] + data[i + 1] + data[i + 2]) / 3;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * channels;
    const lo = Math.min(data[i], data[i + 1], data[i + 2]), hi = Math.max(data[i], data[i + 1], data[i + 2]);
    // Uniform black/white gutters are not missing artwork. Include ink edges
    // so monochrome lettering and drawings still contribute to the audit.
    ink[y * width + x] = +(lo < 242 && hi > 22 || x > 0 && Math.abs(tone(x, y) - tone(x - 1, y)) > 28 || y > 0 && Math.abs(tone(x, y) - tone(x, y - 1)) > 28);
  }
  return { data, width, height, channels, ink };
}

export function borderEvidence(p, raster) {
  const { data, width, height, channels } = raster;
  const sample = (x, y) => {
    const i = (Math.max(0, Math.min(height - 1, Math.round(y * height))) * width + Math.max(0, Math.min(width - 1, Math.round(x * width)))) * channels;
    const lo = Math.min(data[i], data[i + 1], data[i + 2]), hi = Math.max(data[i], data[i + 1], data[i + 2]);
    return [+(lo > 228), +(hi < 48)];
  };
  const edge = (horizontal, fixed, low, length) => {
    if (fixed < .012 || fixed > .988) return 1;
    let best = 0;
    for (let shift = -4; shift <= 4; shift++) {
      let white = 0, black = 0;
      for (let i = 0; i < 64; i++) {
        const along = low + length * (i + .5) / 64, across = fixed + shift / (horizontal ? height : width);
        const values = horizontal ? sample(along, across) : sample(across, along);
        white += values[0]; black += values[1];
      }
      best = Math.max(best, white / 64, black / 64);
    }
    return best;
  };
  const edges = [edge(true, p.y, p.x, p.w), edge(true, p.y + p.h, p.x, p.w), edge(false, p.x, p.y, p.h), edge(false, p.x + p.w, p.y, p.h)];
  return edges.sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0) / 3;
}

export function fusePanels(western, detailed, segmented, bubbles, raster, threshold = .45) {
  // Shape-only predictions on illustrations often follow logos or silhouettes.
  // Require panel-detector evidence before creating a multi-stop layout.
  if (!western.some(p => p.confidence >= threshold) && !detailed.some(p => p.confidence >= Math.max(threshold, .65))) return [];
  // Anchor the ensemble at native scale. Extra scales must not promote props
  // inside an established panel or swallow several independently found panels.
  const candidates = western.filter(p => p.confidence >= threshold).map(p => ({ ...p, evidence: 1, anchor: true }));
  for (const p of [...detailed, ...segmented].filter(p => p.confidence >= threshold)) {
    const match = candidates.map((q, i) => ({ q, i, score: iou(p, q) })).sort((a, b) => b.score - a.score)[0];
    if (match?.score > .55) {
      const q = match.q;
      const comparable = Math.max(area(q), area(p)) / Math.min(area(q), area(p)) < 1.35;
      // Refine closely agreeing boxes only. Unioning inconsistent bounds can
      // silently join neighbours; shape masks can also cut away backgrounds.
      const expanded = union(q, p);
      const aligned = Math.abs(p.y - q.y) < .035 && Math.abs(p.h - q.h) < .06 || Math.abs(p.x - q.x) < .035 && Math.abs(p.w - q.w) < .06;
      const takesNeighbour = candidates.some(other => other !== q && shared(q, other) / area(other) < .5 && shared(expanded, other) - shared(q, other) > Math.min(.025, area(other) * .2));
      const bounds = !takesNeighbour && (comparable && match.score > .75 || aligned) ? expanded : q;
      candidates[match.i] = { ...q, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, confidence: Math.max(q.confidence, p.confidence), evidence: q.evidence + 1 };
    } else {
      // High-resolution detections inside an established panel are commonly
      // clocks, captions or comics pictured in the artwork, not extra panels.
      const contained = candidates.some(q => shared(q, p) / area(p) > .65);
      const swallows = candidates.some(q => shared(q, p) / area(q) > .65);
      if (!contained && !swallows) candidates.push({ ...p, evidence: 1, anchor: false, secondary: p.source === 'western' });
    }
  }
  // Repeated small portraits/panels provide layout evidence for a weak sibling
  // that both scales miss at the normal threshold. Never promote nested props.
  for (const p of [...detailed, ...western].filter(p => p.confidence >= .3 && p.confidence < threshold)) {
    if (candidates.some(q => shared(p, q) / area(p) > .3) || borderEvidence(p, raster) < .85) continue;
    const siblings = candidates.filter(q => Math.abs(p.x - q.x) < .035 && Math.abs(p.w - q.w) < .04 || Math.abs(p.y - q.y) < .035 && Math.abs(p.h - q.h) < .04);
    if (siblings.length >= 2) candidates.push({ ...p, evidence: 2, anchor: false });
  }
  let panels = candidates.map(p => ({ ...p, border: borderEvidence(p, raster) })).filter(p => {
    if (p.w < .025 || p.h < .025 || area(p) < .009) return false;
    // Legal credits and thin decorative borders are common false boxes.
    if ((p.h < .085 && p.w > .65 || p.w < .07 && p.h > .65) && p.confidence < (p.anchor ? .8 : .9)) return false;
    return p.anchor || p.secondary && p.confidence >= .65 || p.confidence >= Math.max(threshold, .85) || p.evidence > 1 || p.confidence >= .65 && p.border > .85;
  });
  panels = panels.filter(p => !panels.some(q => p !== q && area(q) > area(p) * 1.5 && shared(p, q) / area(p) > .65 && (
    area(p) < .014 || bubbles.some(b => shared(p, b) / area(p) > .65) || p.confidence < .85
  )));
  // Two weak, overlapping crops of one continuous illustration do not make
  // two panels (a frequent false positive on full-bleed spreads).
  if (panels.length === 2 && panels.every(p => p.confidence < .85) && shared(...panels) / Math.min(...panels.map(area)) > .2) panels = [];
  if (panels.length === 1) {
    const p = panels[0];
    const otherRegion = [...western, ...detailed].some(q => q.confidence >= .3 && area(q) > .08 && q.h > .1 && shared(q, p) / area(q) < .2);
    if (area(p) > .4 || p.confidence < .8 && !otherRegion) panels = [];
  }
  return panels.map(frame);
}

export function layoutCoverage(panels, raster) {
  const mask = coverageMask(panels, raster.width, raster.height);
  let visible = 0, ink = 0, coveredInk = 0;
  for (let i = 0; i < mask.length; i++) { visible += mask[i]; ink += raster.ink[i]; coveredInk += mask[i] * raster.ink[i]; }
  return { page: visible / mask.length, artwork: ink ? coveredInk / ink : 1 };
}

// Search the uncovered area itself, not a whole-page substitute. A histogram
// sweep finds coherent empty rectangles between known panels in O(w*h).
function missingRectangle(panels, raster) {
  const width = 128, height = Math.max(64, Math.round(width * raster.height / raster.width));
  const occupied = coverageMask(panels, width, height), heights = new Uint16Array(width), stride = width + 1;
  const ink = new Uint32Array(stride * (height + 1));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rx = Math.min(raster.width - 1, Math.floor((x + .5) / width * raster.width)), ry = Math.min(raster.height - 1, Math.floor((y + .5) / height * raster.height));
    const i = (y + 1) * stride + x + 1;
    ink[i] = raster.ink[ry * raster.width + rx] + ink[i - 1] + ink[i - stride] - ink[i - stride - 1];
  }
  let best = null, bestScore = 0;
  for (let y = 0; y < height; y++) {
    const stack = [];
    for (let x = 0; x <= width; x++) {
      const value = x === width ? 0 : heights[x] = occupied[y * width + x] ? 0 : heights[x] + 1;
      let left = x;
      while (stack.length && stack.at(-1).value > value) {
        const previous = stack.pop(); left = previous.left;
        const top = y + 1 - previous.value, w = x - left, h = previous.value;
        if (w / width < .06 || h / height < .04) continue;
        const amount = ink[(y + 1) * stride + x] - ink[top * stride + x] - ink[(y + 1) * stride + left] + ink[top * stride + left];
        if (amount / (w * h) < .12) continue;
        const score = amount * Math.min(1, w / width / .18, h / height / .12);
        if (score > bestScore) { bestScore = score; best = { x: left / width, y: top / height, w: w / width, h: h / height, ink: amount / (width * height) }; }
      }
      if (!stack.length || stack.at(-1).value < value) stack.push({ left, value });
    }
  }
  return best;
}

function expandNeighbour(panels, gap) {
  const choices = panels.map((p, i) => {
    const bounds = union(p, gap), extra = area(bounds) - area(p);
    const alignX = Math.max(0, Math.min(p.x + p.w, gap.x + gap.w) - Math.max(p.x, gap.x)) / Math.min(p.w, gap.w);
    const alignY = Math.max(0, Math.min(p.y + p.h, gap.y + gap.h) - Math.max(p.y, gap.y)) / Math.min(p.h, gap.h);
    const strip = gap.h < .18 && alignX > .7 || gap.w < .14 && alignY > .7;
    const small = area(gap) < .045;
    const overlapsOthers = panels.some((q, n) => n !== i && shared(p, q) / area(q) < .5 && shared(bounds, q) - shared(p, q) > Math.min(.02, area(q) * .2));
    return { i, bounds, extra, valid: (strip || small) && extra < area(gap) * 2.2 && !overlapsOthers };
  }).filter(item => item.valid).sort((a, b) => a.extra - b.extra);
  const best = choices[0];
  if (!best) return false;
  panels[best.i] = frame({ ...panels[best.i], ...best.bounds }); return true;
}

function closeSeams(panels, raster) {
  // Share narrow gutters between their neighbours and extend outer panels to
  // nearby page edges. This includes coloured margins without adding stops.
  return panels.map(p => {
    let x = p.x < .08 ? 0 : p.x, y = p.y < .08 ? 0 : p.y;
    let right = p.x + p.w > .92 ? 1 : p.x + p.w, bottom = p.y + p.h > .92 ? 1 : p.y + p.h;
    // Broad empty outside margins also belong to the adjacent reading frame.
    // Unlike missing artwork, these never warrant a separate reading stop.
    const empty = (x, y, w, h) => {
      let count = 0, ink = 0;
      for (let row = Math.floor(y * raster.height); row < Math.min(raster.height, Math.ceil((y + h) * raster.height)); row++) {
        for (let col = Math.floor(x * raster.width); col < Math.min(raster.width, Math.ceil((x + w) * raster.width)); col++) { ink += raster.ink[row * raster.width + col]; count++; }
      }
      return count > 0 && ink / count < .03;
    };
    if (x > 0 && x < .2 && empty(0, y, x, bottom - y)) x = 0;
    if (y > 0 && y < .2 && empty(x, 0, right - x, y)) y = 0;
    if (right < 1 && right > .8 && empty(right, y, 1 - right, bottom - y)) right = 1;
    if (bottom < 1 && bottom > .8 && empty(x, bottom, right - x, 1 - bottom)) bottom = 1;
    for (const q of panels) {
      if (p === q) continue;
      const alignX = Math.max(0, Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x)) / p.w;
      const alignY = Math.max(0, Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y)) / p.h;
      const gapRight = q.x - p.x - p.w, gapBottom = q.y - p.y - p.h;
      const gapLeft = p.x - q.x - q.w, gapTop = p.y - q.y - q.h;
      if (alignY > .7 && gapRight > 0 && gapRight < .06) right = Math.max(right, p.x + p.w + gapRight / 2);
      if (alignY > .7 && gapLeft > 0 && gapLeft < .06) x = Math.min(x, p.x - gapLeft / 2);
      if (alignX > .7 && gapBottom > 0 && gapBottom < .06) bottom = Math.max(bottom, p.y + p.h + gapBottom / 2);
      if (alignX > .7 && gapTop > 0 && gapTop < .06) y = Math.min(y, p.y - gapTop / 2);
    }
    return frame({ ...p, x, y, w: right - x, h: bottom - y });
  });
}

export function recoverLayout(initial, bubbles, raster) {
  if (!initial.length) return { panels: [frame({ x: 0, y: 0, w: 1, h: 1, confidence: 0, source: 'whole-page' })], fallback: true, recovered: 0 };
  let panels = closeSeams(initial.map(p => frame({ ...p })), raster), recovered = 0;
  // Recover missing panels/regions, and enlarge clipped neighbours for narrow
  // leftovers. Recovery stops once substantive artwork is accounted for.
  for (let pass = 0; pass < 20; pass++) {
    const coverage = layoutCoverage(panels, raster);
    if (coverage.page >= .9 && coverage.artwork >= .97) break;
    const gap = missingRectangle(panels, raster);
    if (!gap || gap.ink < .004 || area(gap) < .008) break;
    if (expandNeighbour(panels, gap)) continue;
    if (area(gap) < .025) break;
    panels.push(frame({ x: gap.x, y: gap.y, w: gap.w, h: gap.h, confidence: 0, source: 'recovered-region' })); recovered++;
  }
  panels = closeSeams(panels, raster);
  // Close tiny border/margin seams without making more reading stops.
  panels = panels.map(p => {
    const padding = .006, x = Math.max(0, p.x - padding), y = Math.max(0, p.y - padding);
    return frame({ ...p, x, y, w: Math.min(1, p.x + p.w + padding) - x, h: Math.min(1, p.y + p.h + padding) - y });
  });
  panels = protectBubbles(panels, bubbles);
  return { panels, recovered, fallback: panels.length === 1 && area(panels[0]) > .95 };
}
