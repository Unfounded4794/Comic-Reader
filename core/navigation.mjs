// Rank actual rendered rectangles. Controls in the same row/column win over
// diagonal shortcuts, even when the diagonal control is closer by its centre.
export function spatialTarget(from, candidates, key) {
  const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
  const reverse = key === 'ArrowLeft' || key === 'ArrowUp';
  const start = horizontal ? 'left' : 'top', end = horizontal ? 'right' : 'bottom';
  const crossStart = horizontal ? 'top' : 'left', crossEnd = horizontal ? 'bottom' : 'right';
  const center = r => (r[start] + r[end]) / 2;
  return candidates.map(candidate => {
    const r = candidate.rect;
    const advance = (center(r) - center(from)) * (reverse ? -1 : 1);
    const edge = reverse ? from[start] - r[end] : r[start] - from[end];
    const overlap = Math.min(from[crossEnd], r[crossEnd]) - Math.max(from[crossStart], r[crossStart]);
    const crossGap = Math.max(0, -overlap);
    const aligned = overlap > Math.min(from[crossEnd] - from[crossStart], r[crossEnd] - r[crossStart]) * .2;
    const crossCenter = Math.abs((r[crossStart] + r[crossEnd] - from[crossStart] - from[crossEnd]) / 2);
    return { candidate, advance, edge, aligned, score: Math.max(0, edge) + crossGap * 3 + crossCenter * .1 };
  }).filter(c => c.advance > 3 && c.edge >= -2 && (c.aligned || c.score < c.advance * 4))
    .sort((a, b) => Number(b.aligned) - Number(a.aligned) || a.score - b.score)[0]?.candidate ?? null;
}
