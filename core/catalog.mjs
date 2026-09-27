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
    const furthest = read.reduce((best, value) => value.index > best.index ? value : best);
    const next = issues.slice(furthest.index + 1).find(issue => !issue.lastRead);
    if (next) result.push({ series: folderName(next.folder || next.root), previous: furthest.issue, next, lastRead: Math.max(...read.map(value => value.issue.lastRead)) });
  }
  return result.sort((a, b) => b.lastRead - a.lastRead);
}
