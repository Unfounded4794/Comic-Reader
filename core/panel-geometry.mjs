const clamp = v => Math.max(0, Math.min(1, v));
export const boxPolygon = p => [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
export function polygonBounds(polygon) {
  const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
function overlap(a, b) {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
}
export function protectBubbles(panels, bubbles) {
  const assigned = panels.map(p => ({ ...p, protectedRegions: [] }));
  for (const bubble of bubbles) {
    // Use the original panels for every assignment: expanding for one bubble
    // must not steal the next bubble from its actual neighbouring panel.
    const matches = panels.map((p, i) => ({ i, p, share: overlap(p, bubble) / (bubble.w * bubble.h) }))
      .filter(item => item.share >= .2).sort((a, b) => b.share - a.share || a.p.w * a.p.h - b.p.w * b.p.h);
    const owner = matches[0];
    if (!owner) continue;
    const x = clamp(bubble.x - .004), y = clamp(bubble.y - .004);
    const region = { x, y, w: clamp(bubble.x + bubble.w + .004) - x, h: clamp(bubble.y + bubble.h + .004) - y };
    assigned[owner.i].protectedRegions.push(region);
  }
  return assigned.map(p => {
    const polygon = p.polygon ?? boxPolygon(p);
    // A mask can extend past its detector's box. Fit the complete visible
    // outline AND owned dialogue, so neither is clipped by camera framing.
    const bounds = polygonBounds([...polygon, ...p.protectedRegions.flatMap(boxPolygon)]);
    return { ...p, ...bounds, polygon };
  });
}

// Rasterize the UNION of visible outlines; summing box areas would count
// overlaps twice and falsely certify pages whose artwork is still missing.
export function coverageMask(panels, width = 160, height = 224) {
  const mask = new Uint8Array(width * height);
  for (const p of panels) for (const polygon of [p.polygon ?? boxPolygon(p), ...(p.protectedRegions ?? []).map(boxPolygon)]) {
    const bounds = polygonBounds(polygon);
    for (let row = Math.max(0, Math.floor(bounds.y * height)); row < Math.min(height, Math.ceil((bounds.y + bounds.h) * height)); row++) {
      const y = (row + .5) / height, crossings = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        if ((a[1] > y) !== (b[1] > y)) crossings.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
      crossings.sort((a, b) => a - b);
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const left = Math.max(0, Math.ceil(crossings[i] * width - .5)), right = Math.min(width, Math.ceil(crossings[i + 1] * width - .5));
        if (right > left) mask.fill(1, row * width + left, row * width + right);
      }
    }
  }
  return mask;
}
export function panelCoverage(panels) {
  const mask = coverageMask(panels);
  return mask.reduce((sum, value) => sum + value, 0) / mask.length;
}
