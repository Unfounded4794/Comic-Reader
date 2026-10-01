const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const naturalTitle = (a, b) => collator.compare(a.title, b.title);
export const folderKey = value => String(value ?? '').replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase();
export const folderName = value => String(value ?? '').split(/[\\/]/).filter(Boolean).at(-1) || String(value ?? '');
const childPath = (root, relative) => {
  const separator = String(root).includes('\\') ? '\\' : '/';
  return `${String(root).replace(/[\\/]$/, '')}${separator}${relative.replaceAll('/', separator)}`;
};

export function folderTree(folders, books) {
  return folders.map(root => {
    const node = { key: folderKey(root), path: root, root, name: folderName(root), relative: '', children: [], direct: 0, count: 0 };
    const byRelative = new Map([['', node]]);
    for (const book of books.filter(book => folderKey(book.root) === node.key)) {
      let relative = '';
      for (const part of String(book.relativeDir ?? '').split(/[\\/]/).filter(Boolean)) {
        const parent = byRelative.get(relative);
        relative = relative ? `${relative}/${part}` : part;
        if (!byRelative.has(relative)) {
          const child = { key: `${node.key}/${relative.toLocaleLowerCase()}`, path: childPath(root, relative), root, name: part, relative, children: [], direct: 0, count: 0 };
          byRelative.set(relative, child); parent.children.push(child);
        }
      }
      byRelative.get(relative).direct++;
    }
    const total = current => {
      current.children.sort((a, b) => collator.compare(a.name, b.name));
      current.count = current.direct + current.children.reduce((sum, child) => sum + total(child), 0);
      return current.count;
    };
    total(node); return node;
  });
}

export function booksInFolder(books, selection) {
  if (!selection) return books;
  const root = folderKey(selection.root), relative = String(selection.relative ?? '').replaceAll('\\', '/').replace(/^\/|\/$/g, '').toLocaleLowerCase();
  return books.filter(book => {
    if (folderKey(book.root) !== root) return false;
    const candidate = String(book.relativeDir ?? '').replaceAll('\\', '/').replace(/^\/|\/$/g, '').toLocaleLowerCase();
    return !relative || candidate === relative || candidate.startsWith(relative + '/');
  });
}

export function directBooksInFolder(books, selection) {
  if (!selection) return books.filter(book => !book.root);
  const root = folderKey(selection.root), relative = String(selection.relative ?? '').replaceAll('\\', '/').replace(/^\/|\/$/g, '').toLocaleLowerCase();
  return books.filter(book => folderKey(book.root) === root && String(book.relativeDir ?? '').replaceAll('\\', '/').replace(/^\/|\/$/g, '').toLocaleLowerCase() === relative);
}

export function findFolderNode(trees, selection) {
  if (!selection) return null;
  const wantedRoot = folderKey(selection.root), wantedRelative = String(selection.relative ?? '').replaceAll('\\', '/').replace(/^\/|\/$/g, '').toLocaleLowerCase();
  const visit = node => {
    if (folderKey(node.root) === wantedRoot && node.relative.toLocaleLowerCase() === wantedRelative) return node;
    for (const child of node.children) { const found = visit(child); if (found) return found; }
    return null;
  };
  for (const tree of trees) { const found = visit(tree); if (found) return found; }
  return null;
}

export function readingHistory(books) {
  return books.filter(book => book.lastRead && !book.missing).sort((a, b) => b.lastRead - a.lastRead);
}

// Home shows the contents of all library sources as one collection. A source
// with subfolders contributes those first-level folders; a source that is
// already a series remains visible so its directly-contained books are not
// stranded in the sidebar.
export function homeCollections(trees) {
  return trees.flatMap(root => root.children.length ? root.children : [root]);
}

export function homeBooks(trees, books) {
  const expandedRoots = new Set(trees.filter(root => root.children.length).map(root => root.key));
  return books.filter(book => !book.root || (expandedRoots.has(folderKey(book.root)) && !book.relativeDir));
}

export function adjacentComic(books, current, delta) {
  if (!current) return null;
  const series = folderKey(current.folder || current.path?.replace(/[\\/][^\\/]+$/, '') || current.root);
  const issues = books.filter(book => !book.missing && folderKey(book.folder || book.path?.replace(/[\\/][^\\/]+$/, '') || book.root) === series).sort(naturalTitle);
  const index = issues.findIndex(book => book.id === current.id);
  return index < 0 ? null : issues[index + delta] ?? null;
}

export function seriesContinuations(books) {
  const groups = new Map();
  for (const book of books.filter(book => !book.missing)) {
    const key = folderKey(book.folder || book.root || book.path?.replace(/[\\/][^\\/]+$/, ''));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(book);
  }
  const result = [];
  for (const issues of groups.values()) {
    issues.sort(naturalTitle);
    const read = issues.map((issue, index) => ({ issue, index })).filter(({ issue }) => issue.lastRead);
    if (!read.length) continue;
    const recent = read.reduce((best, value) => value.issue.lastRead > best.issue.lastRead ? value : best);
    const progress = recent.issue.progress;
    const unfinished = !progress || !recent.issue.pageCount || progress.page < recent.issue.pageCount - 1 || (recent.issue.pageCount === 1 && (progress.offset ?? 0) < .98);
    const nextUnread = issues.slice(recent.index + 1).find(issue => !issue.lastRead);
    const next = unfinished || !nextUnread ? recent.issue : nextUnread;
    result.push({ series: folderName(next.folder || next.root), previous: recent.issue, next, resume: next.id === recent.issue.id, lastRead: recent.issue.lastRead });
  }
  return result.sort((a, b) => b.lastRead - a.lastRead);
}
