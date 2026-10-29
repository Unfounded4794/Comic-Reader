// Shared by the desktop engine and the renderer; no filesystem dependencies.
export function readingComplete({ page, panel = 0, mode = 'page', atEnd = false }, pageCount, panelCount = 0) {
  if (mode === 'webtoon') return atEnd;
  if (page !== pageCount - 1) return false;
  if (mode === 'guided') return panelCount > 0 && panel >= panelCount - 1;
  return true;
}
export function legacyCompleted(book) {
  if (typeof book.completed === 'boolean') return book.completed;
  return !!book.pageCount && book.progress?.page === book.pageCount - 1 && (book.pageCount > 1 || (book.progress.offset ?? 0) >= .98);
}
