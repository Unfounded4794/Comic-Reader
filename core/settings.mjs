export const ACTIONS = [
  ['openFile', 'Open comic', 'Ctrl+O'], ['addFolder', 'Add library folder', 'Ctrl+Shift+O'],
  ['openImages', 'Open image folder / webtoon', 'Ctrl+Alt+O'], ['rescan', 'Rescan library', 'F5'],
  ['savePage', 'Save original page', 'Ctrl+Shift+S'], ['favorite', 'Toggle favorite comic', 'Ctrl+D'],
  ['library', 'Show library / return to reader', 'L'], ['settings', 'Preferences & shortcuts', 'Ctrl+Comma'],
  ['next', 'Next page / panel', 'ArrowRight'], ['previous', 'Previous page / panel', 'ArrowLeft'],
  ['nextPage', 'Next whole page', 'PageDown'], ['previousPage', 'Previous whole page', 'PageUp'],
  ['first', 'First page', 'Home'], ['last', 'Last page', 'End'], ['goToPage', 'Go to page', 'G'],
  ['scrollDown', 'Scroll down within page', 'ArrowDown'], ['scrollUp', 'Scroll up within page', 'ArrowUp'],
  ['scrollLeft', 'Scroll left within page', 'Shift+ArrowLeft'], ['scrollRight', 'Scroll right within page', 'Shift+ArrowRight'],
  ['fitPage', 'Fit entire page', 'F'], ['fitWidth', 'Fit width', 'W'], ['fitHeight', 'Fit height', 'H'],
  ['zoomIn', 'Zoom in', 'Equal'], ['zoomOut', 'Zoom out', 'Minus'], ['actualSize', 'Actual size', 'Digit0'],
  ['fullscreen', 'Toggle clean fullscreen', 'F11'], ['exitFullscreen', 'Exit fullscreen / close dialog', 'Escape'],
  ['toggleChrome', 'Show / hide controls', 'Tab'], ['counter', 'Toggle page counter', 'C'],
  ['guided', 'Toggle guided panel reading', 'P'], ['webtoon', 'Toggle continuous webtoon reading', 'T'],
  ['editPanels', 'Edit panels & reading order', 'E'], ['redetect', 'Detect this page again', 'Ctrl+R'],
  ['nextComic', 'Next comic in library', 'Ctrl+ArrowRight'], ['previousComic', 'Previous comic in library', 'Ctrl+ArrowLeft'],
  ['toggleDirection', 'Switch left-to-right / right-to-left', 'M'], ['background', 'Choose reading background', 'B'],
  ['search', 'Search library', 'Ctrl+F'], ['sortLibrary', 'Cycle library sort', 'S'], ['newOnly', 'Toggle newly added filter', 'N'],
  ['editorAdd', 'Draw rectangular panel', 'A'], ['editorPolygon', 'Draw polygon panel', 'D'],
  ['editorSelect', 'Select a panel', 'V'], ['editorDelete', 'Delete selected panel', 'Delete'],
  ['editorEarlier', 'Move panel earlier', 'BracketLeft'], ['editorLater', 'Move panel later', 'BracketRight'],
  ['editorSave', 'Save panel corrections', 'Ctrl+S'], ['editorFinish', 'Finish polygon', 'Enter'],
  ['resetShortcuts', 'Restore default shortcuts', 'Ctrl+Shift+Backspace'], ['quit', 'Quit', 'Ctrl+Q'],
];
export const DEFAULT_SETTINGS = {
  background: '#141619', scrollAmount: 160, smoothScroll: true, fit: 'page', panelFit: 'page',
  mode: 'page', direction: 'ltr', showCounter: true, panelPadding: 3, panelDim: 0.84,
  detectionThreshold: 0.45, shapeDetection: true, autoScanMinutes: 5,
  webtoonWidth: 900, webtoonGap: 0, autoNextComic: false, savePageFolder: '', progressFolder: '',
  shortcuts: Object.fromEntries(ACTIONS.map(([id, , key]) => [id, key])),
};
export function normalizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts } };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof fallback === 'boolean' && typeof input[key] === 'boolean') out[key] = input[key];
  }
  const ranges = { scrollAmount: [10, 2000], panelPadding: [0, 20], panelDim: [0, 1], detectionThreshold: [0.1, 0.9], autoScanMinutes: [0, 120], webtoonWidth: [240, 4000], webtoonGap: [0, 100] };
  for (const [key, [min, max]] of Object.entries(ranges)) if (Number.isFinite(input[key])) out[key] = Math.min(max, Math.max(min, input[key]));
  if (/^#[a-f\d]{6}$/i.test(input.background)) out.background = input.background;
  if (['page', 'width', 'height', 'actual'].includes(input.fit)) out.fit = input.fit;
  if (['page', 'width', 'height', 'actual'].includes(input.panelFit)) out.panelFit = input.panelFit;
  if (['page', 'guided', 'webtoon'].includes(input.mode)) out.mode = input.mode;
  if (['ltr', 'rtl'].includes(input.direction)) out.direction = input.direction;
  if (typeof input.savePageFolder === 'string' && input.savePageFolder.length < 32768 && !input.savePageFolder.includes('\0')) out.savePageFolder = input.savePageFolder;
  if (typeof input.progressFolder === 'string' && input.progressFolder.length < 32768 && !input.progressFolder.includes('\0')) out.progressFolder = input.progressFolder;
  for (const [id] of ACTIONS) if (typeof input.shortcuts?.[id] === 'string' && input.shortcuts[id].length < 90) out.shortcuts[id] = input.shortcuts[id];
  return out;
}
export function keyChord(event) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) return '';
  const code = event.code || event.key;
  const key = /^Key[A-Z]$/.test(code) ? code.slice(3) : code;
  return [...(event.ctrlKey || event.metaKey ? ['Ctrl'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), key].join('+');
}
