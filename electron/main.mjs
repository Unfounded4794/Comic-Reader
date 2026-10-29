import { app, BrowserWindow, dialog, ipcMain, protocol, net, session, shell, Menu } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { scanFolders, bookId } from '../core/library.mjs';
import { COMIC_RE, IMAGE_RE } from '../core/archive.mjs';
import { normalizeSettings } from '../core/settings.mjs';
import { saveOriginalPage } from '../core/page-export.mjs';
import { ReadingProgress, fingerprint, legacyCompleted, readingComplete } from '../core/reading-progress.mjs';
import { coverPath } from '../core/media-cache.mjs';
const appId = 'org.panelreader.desktop';
if (process.platform === 'win32') app.setAppUserModelId(appId);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const readableFile = value => COMIC_RE.test(value) || IMAGE_RE.test(value);
if (process.env.PANEL_READER_DATA) app.setPath('userData', path.resolve(process.env.PANEL_READER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'comic', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'reader', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, worker, coverWorker, panelWorker, scanTimer, scanning, scanController, state = { folders: [], books: [], settings: normalizeSettings(), lastBook: null };
let saveQueue = Promise.resolve(); let serial = 0; const calls = new Map();
let reading, syncTimer, indexing, identityController, flushClose, indexAgain = false, readerActive = false;
const identities = new Map(), sessions = new Map();
const savedPages = new Set();
async function reveal(file) {
  try { await fs.stat(file); } catch { throw new Error('This location is unavailable. Check the drive connection.'); }
  shell.showItemInFolder(file);
}
const statePath = () => path.join(app.getPath('userData'), 'library.json');
function save() {
  const content = JSON.stringify(state);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const target = statePath(), temp = target + '.tmp'; await fs.writeFile(temp, content); await fs.rename(temp, target);
  });
  return saveQueue;
}
function emit(event, data) { if (window && !window.isDestroyed()) window.webContents.send('reader:' + event, data); }
function rpc(method, args) {
  const engine = ['panels', 'savePanels'].includes(method) ? panelWorker : method === 'image' && args.thumbnail ? coverWorker : worker;
  if (!engine) return Promise.reject(new Error('The reader engine is not running. Restart the app.'));
  const book = state.books.find(book => book.path === args.file);
  if (book && Number.isFinite(book.size) && Number.isFinite(book.modified)) args = { ...args, source: { size: book.size, modified: book.modified, pageCount: book.pageCount } };
  const id = ++serial;
  return new Promise((resolve, reject) => { calls.set(id, { resolve, reject, engine }); engine.postMessage({ id, method, args }); });
}
function getBook(id) { const book = state.books.find(b => b.id === id); if (!book) throw new Error('Comic is not in the library.'); return book; }
function applyReading(book) {
  const value = reading?.get(book.contentId);
  if (value?.heads.length) Object.assign(book, { progress: value.unread ? undefined : value.progress, completed: value.completed, pageCount: value.pageCount, lastRead: value.unread ? undefined : value.lastRead, isNew: false, readingRevision: value.revision, readingConflicts: value.conflicts });
}
async function identifyBook(id, known, signal) {
  const book = getBook(id), file = book.path;
  if (identities.has(file) && !known) return identities.get(file);
  const task = (async () => {
    const identity = await fingerprint(file, book, { known, signal });
    // A foreground open already has a freshly read index. It supersedes an
    // outstanding background lookup instead of waiting for network metadata.
    if (identities.get(file) !== task) return state.books.find(item => item.id === id);
    const current = state.books.find(item => item.id === id && item.path === file);
    if (!current) return;
    if (identity.legacyContentId) {
      await reading.linkKeys(identity.contentId, identity.legacyContentId);
      if (current.progressSeeded === identity.legacyContentId) current.progressSeeded = identity.contentId;
    }
    if (current.contentId && current.contentId !== identity.contentId && !identity.legacyContentId) {
      // A new edition at the same path is a different book. Its old history
      // remains in the content store and must not migrate to the replacement.
      delete current.progress; delete current.lastRead; delete current.pageCount;
      delete current.readingRevision; delete current.readingConflicts;
      current.completed = false; current.isNew = true;
    }
    delete identity.legacyContentId; Object.assign(current, identity);
    if (current.progressSeeded !== identity.contentId) {
      if (current.lastRead && current.progress && current.pageCount) {
        const p = current.progress;
        await reading.record(identity.contentId, { progress: { page: p.page, panel: p.panel ?? 0, offset: p.offset ?? 0, mode: p.mode ?? 'page' }, completed: legacyCompleted(current), pageCount: current.pageCount, at: current.lastRead });
      }
      current.progressSeeded = identity.contentId;
    }
    applyReading(current);
    return current;
  })().finally(() => { if (identities.get(file) === task) identities.delete(file); });
  identities.set(file, task); return task;
}
function indexBooks() {
  if (!reading) return;
  if (readerActive || scanning || state.scanStatus?.cancelled) return;
  if (indexing) { indexAgain = true; return indexing; }
  identityController = new AbortController(); const signal = identityController.signal;
  indexing = (async () => {
    // Sequential streaming keeps large libraries from flooding a network disk.
    for (const book of [...state.books]) {
      if (signal.aborted) break;
      // Only indexed ZIP/CBZ archives need background matching. RAR and image
      // identities are obtained from bytes already loaded by the reader.
      if (book.missing || !/\.(cbz|zip)$/i.test(book.path) || !state.books.some(item => item.id === book.id)) continue;
      try { await identifyBook(book.id, undefined, signal); }
      catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR', 'ABORT_ERR'].includes(error.code)) console.error('Could not identify comic:', error.message); }
    }
    await save(); emit('library', state); void reading.sync();
  })().catch(error => emit('error', error.message)).finally(() => { indexing = null; if (indexAgain) { indexAgain = false; void indexBooks(); } });
  return indexing;
}
async function addPaths(files) {
  if (!Array.isArray(files) || files.length > 500) throw new Error('Select at most 500 files.');
  const added = [];
  for (const file of files) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('Invalid file path.');
    const stat = await fs.stat(file);
    if (!stat.isDirectory() && !readableFile(file)) throw new Error('Choose a comic archive, supported image, or image folder.');
    const id = bookId(file); let book = state.books.find(b => b.id === id);
    if (!book) { book = { id, path: file, folder: stat.isDirectory() ? file : path.dirname(file), source: 'opened', title: stat.isDirectory() ? path.basename(file) : path.basename(file, path.extname(file)), format: stat.isDirectory() ? 'IMAGES' : path.extname(file).slice(1).toUpperCase(), added: Date.now(), size: stat.size, modified: stat.mtimeMs, isNew: true }; state.books.push(book); }
    added.push(book);
  }
  await save(); emit('library', state); void indexBooks(); return added;
}
async function rescan() {
  if (scanning) return scanning;
  identityController?.abort(); scanController = new AbortController();
  state.scanStatus = { active: true, foldersDone: 0, foldersFound: 1, filesFound: 0, added: 0 }; emit('scanProgress', state.scanStatus);
  scanning = (async () => {
    const snapshot = state.books;
    const result = await scanFolders([...state.folders], snapshot, { signal: scanController.signal,
      onProgress(progress) { state.scanStatus = { ...progress, active: true }; emit('scanProgress', state.scanStatus); },
      onBatch(batch) {
        const current = new Map(state.books.map(book => [book.id, book]));
        const changed = [];
        for (const book of batch) {
          const latest = current.get(book.id);
          current.set(book.id, latest ? { ...book, progress: latest.progress, completed: latest.completed, isNew: latest.isNew, lastRead: latest.lastRead, favorite: latest.favorite, progressSeeded: latest.progressSeeded, contentId: latest.contentId, fingerprintStamp: latest.fingerprintStamp, fingerprintVersion: latest.fingerprintVersion } : book);
          changed.push(current.get(book.id));
        }
        state.books = [...current.values()]; emit('libraryBatch', { books: changed, folders: state.folders });
      },
    });
    // Progress or separately opened books can change while the disk scan is running.
    const current = new Map(state.books.map(b => [b.id, b]));
    state.books = result.books.map(b => { const latest = current.get(b.id); current.delete(b.id); return latest ? { ...b, progress: latest.progress, completed: latest.completed, isNew: latest.isNew, lastRead: latest.lastRead, favorite: latest.favorite, contentId: latest.contentId, fingerprintStamp: latest.fingerprintStamp, fingerprintVersion: latest.fingerprintVersion, progressSeeded: latest.progressSeeded } : b; });
    state.books.push(...current.values());
    state.books.forEach(applyReading);
    state.scanStatus = { ...state.scanStatus, active: false, cancelled: result.cancelled }; emit('scanProgress', state.scanStatus);
    await save(); emit('library', state); return { ...result, books: state.books };
  })().finally(() => { scanning = null; state.scanStatus = { ...state.scanStatus, active: false }; emit('scanProgress', state.scanStatus); if (!state.scanStatus.cancelled) void indexBooks(); });
  return scanning;
}
function scheduleScan() { clearInterval(scanTimer); if (state.settings.autoScanMinutes > 0) scanTimer = setInterval(() => rescan().catch(e => emit('error', e.message)), state.settings.autoScanMinutes * 60000); }
function handle(name, fn) {
  ipcMain.handle('reader:' + name, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Untrusted caller.');
    return fn(...args);
  });
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit();
else {
  app.on('second-instance', async (_, argv) => {
    window?.show(); window?.focus();
    const files = argv.filter(a => readableFile(a) && path.isAbsolute(a));
    if (files.length) { try { const books = await addPaths(files); emit('open', books[0].id); } catch (e) { emit('error', e.message); } }
  });
  app.whenReady().then(async () => {
  try {
    const saved = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    state = { ...state, ...saved, settings: normalizeSettings(saved.settings), books: Array.isArray(saved.books) ? saved.books : [], folders: Array.isArray(saved.folders) ? saved.folders : [] };
    state.books = state.books.map(book => book.root ? { ...book, source: 'library', folder: book.folder || path.dirname(book.path), relativeDir: book.relativeDir ?? path.relative(book.root, path.dirname(book.path)) } : { ...book, source: book.source || 'opened', folder: book.folder || path.dirname(book.path) });
  }
  catch (e) { if (e.code !== 'ENOENT') console.error('Could not restore library:', e.message); }
  state.books.forEach(book => { book.completed = legacyCompleted(book); });
  reading = new ReadingProgress({ localFile: path.join(app.getPath('userData'), 'reading-progress.json'), sharedFolder: () => state.settings.progressFolder,
    onChange(keys, remote) {
      const affected = state.books.filter(book => keys.includes(book.contentId));
      affected.forEach(applyReading); void save().catch(error => emit('error', error.message)); emit('library', state);
      if (remote) for (const book of affected) {
        const session = sessions.get(book.id), value = reading.get(book.contentId);
        if (session && value.heads.some(head => Object.entries(head.clock).some(([device, count]) => (session.clock[device] ?? 0) < count))) emit('remoteProgress', { id: book.id });
      }
    }, onStatus(status) { state.syncStatus = status; emit('syncStatus', status); },
  });
  await reading.init(); state.books.forEach(applyReading);
  function createEngine(role) {
    const engine = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { role, models: app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(root, 'models'), cache: path.join(app.getPath('userData'), 'cache') } });
    engine.on('message', ({ id, result, error }) => { const call = calls.get(id); if (!call) return; calls.delete(id); error ? call.reject(new Error(error)) : call.resolve(result); });
    const fail = error => { for (const [id, call] of calls) if (call.engine === engine) { call.reject(error); calls.delete(id); } };
    engine.on('error', error => { fail(error); emit('error', error.message); });
    engine.on('exit', code => fail(new Error(`${role} engine exited (${code}). Restart the app.`)));
    return engine;
  }
  worker = createEngine('reader'); coverWorker = createEngine('covers'); panelWorker = createEngine('panels');
  protocol.handle('comic', async request => {
    try {
      const url = new URL(request.url), match = url.pathname.match(/^\/([a-f0-9]{24})\/(\d+)\/(image|cover|tile\/(\d+))$/);
      if (url.hostname !== 'book' || !match) return new Response('', { status: 404 });
      const book = getBook(match[1]), page = Number(match[2]);
      if (match[3] === 'cover' && Number.isFinite(book.size) && Number.isFinite(book.modified)) {
        try { return new Response(await fs.readFile(coverPath(path.join(app.getPath('userData'), 'cache'), book.path, book)), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } }); } catch {}
      }
      const result = await rpc('image', { file: book.path, page, thumbnail: match[3] === 'cover', tile: match[4] === undefined ? undefined : Number(match[4]) });
      if (result.identity && (book.contentId !== result.identity.contentId || book.fingerprintVersion !== 2)) {
        void identifyBook(book.id, result.identity).then(() => { emit('library', state); return save(); }).catch(error => console.error('Could not match cover history:', error.message));
      }
      return new Response(result.bytes, { headers: { 'Content-Type': result.mime, 'Cache-Control': match[3] === 'cover' ? 'private, max-age=31536000, immutable' : 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    } catch (e) { return new Response(e.message, { status: 400 }); }
  });
  protocol.handle('reader', request => {
    const url = new URL(request.url), base = path.join(root, 'dist'), relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname), file = path.resolve(base, '.' + relative);
    if (url.hostname !== 'app' || !file.startsWith(base + path.sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).href);
  });
  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  handle('state', () => state);
  handle('chooseProgressFolder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose the same shared progress folder on each device', defaultPath: state.settings.progressFolder || undefined, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    state.settings.progressFolder = result.filePaths[0]; await save(); void reading.sync(); return state.settings;
  });
  handle('stopSharing', async () => { state.settings.progressFolder = ''; await save(); await reading.sync(); return state.settings; });
  handle('syncProgress', async () => { await reading.sync({ force: true }); return state.syncStatus; });
  handle('view', view => { readerActive = view === 'reader'; if (readerActive) identityController?.abort(); else void indexBooks(); });
  handle('cancelScan', () => { scanController?.abort(); identityController?.abort(); });
  const markReading = async (id, completed) => {
    let book = getBook(id);
    // Manual completion needs the actual page count even before first open.
    if (completed) {
      const opened = await rpc('open', { file: book.path });
      book = await identifyBook(id, opened.identity); book.pageCount = opened.names.length;
    } else book = await identifyBook(id);
    const saved = reading.get(book.contentId);
    const pageCount = book.pageCount ?? saved.pageCount ?? 1;
    await reading.record(book.contentId, { progress: { page: completed ? pageCount - 1 : 0, panel: 0, offset: completed ? 1 : 0, mode: 'page' }, pageCount, completed, unread: !completed, clock: saved.clock });
    const resetContentIds = reading.document.aliases?.[book.contentId] ?? [book.contentId];
    for (const current of state.books.filter(value => resetContentIds.includes(value.contentId))) sessions.delete(current.id);
    applyReading(book); await save(); emit('library', state); void reading.sync(); return { ...book, resetContentIds };
  };
  handle('markUnread', id => markReading(id, false));
  handle('markRead', id => markReading(id, true));
  handle('bookContextMenu', id => {
    const book = getBook(id);
    Menu.buildFromTemplate([{ label: 'Open file location', click: () => { void reveal(book.path).catch(error => emit('error', error.message)); } }]).popup({ window });
  });
  handle('revealSavedPage', file => {
    if (!savedPages.has(file)) throw new Error('This page has not been saved in this session.');
    return reveal(file);
  });
  handle('resolveProgress', async (id, eventId, revision) => {
    const book = await identifyBook(id);
    const result = await reading.resolve(book.contentId, eventId, revision);
    applyReading(book); await save(); void reading.sync(); return result;
  });
  handle('chooseSaveFolder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose a folder for saved pages', defaultPath: state.settings.savePageFolder || undefined, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('savePage', async (id, page) => {
    const book = getBook(id);
    const original = await rpc('original', { file: book.path, page });
    const result = await saveOriginalPage({ ...original, title: book.title, folder: state.settings.savePageFolder });
    savedPages.add(result.path); return result;
  });
  handle('favorite', async id => {
    const book = getBook(id); book.favorite = !book.favorite;
    const favorite = book.favorite;
    await save(); emit('library', state); return favorite;
  });
  handle('chooseComic', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open comic or image', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Comics and images', extensions: ['cbz', 'cbr', 'zip', 'rar', 'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff'] }, { name: 'Comic archives', extensions: ['cbz', 'cbr', 'zip', 'rar'] }, { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tif', 'tiff'] }] });
    return result.canceled ? [] : addPaths(result.filePaths);
  });
  handle('chooseImages', async () => { const result = await dialog.showOpenDialog(window, { title: 'Open folder of page images', properties: ['openDirectory'] }); return result.canceled ? [] : addPaths(result.filePaths); });
  handle('chooseFolder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Add a library folder (including subfolders)', properties: ['openDirectory'] });
    if (result.canceled) return null;
    if (!state.folders.includes(result.filePaths[0])) state.folders.push(result.filePaths[0]);
    await save(); emit('library', state); return rescan();
  });
  handle('addPaths', addPaths);
  handle('changeFolder', async folder => {
    if (typeof folder !== 'string' || !state.folders.some(value => pathKey(value) === pathKey(folder))) throw new Error('Library folder is no longer available.');
    if (scanning) { scanController?.abort(); await scanning; }
    const result = await dialog.showOpenDialog(window, { title: 'Choose the new location for this library folder', properties: ['openDirectory'] });
    if (result.canceled) return null;
    const replacement = path.resolve(result.filePaths[0]);
    state.folders = [...new Map(state.folders.map(value => pathKey(value) === pathKey(folder) ? replacement : value).map(value => [pathKey(value), value])).values()];
    state.books = state.books.map(book => {
      if (!book.root || pathKey(book.root) !== pathKey(folder)) return book;
      const relativeFile = path.relative(folder, book.path), nextPath = path.join(replacement, relativeFile);
      return { ...book, id: bookId(nextPath), path: nextPath, root: replacement, folder: path.dirname(nextPath), relativeDir: path.relative(replacement, path.dirname(nextPath)) };
    });
    await save(); return rescan();
  });
  handle('removeFolder', async folder => {
    if (typeof folder !== 'string') throw new Error('Invalid library folder.');
    if (scanning) { scanController?.abort(); await scanning; }
    state.folders = state.folders.filter(value => pathKey(value) !== pathKey(folder));
    state.books = state.books.filter(book => !book.root || pathKey(book.root) !== pathKey(folder));
    await save(); emit('library', state); return state;
  });
  handle('rescan', rescan);
  handle('open', async id => {
    readerActive = true; identityController?.abort(); void reading.sync();
    let book = getBook(id);
    const result = await rpc('open', { file: book.path });
    book = await identifyBook(id, result.identity); let saved = reading.get(book.contentId);
    if (saved.conflicts.length) return { id, title: book.title, conflicts: saved.conflicts, revision: saved.revision };
    // Opening a large archive can overlap an exchange or a library rescan.
    // Bind the session to the exact bookmark returned to the reader.
    book = getBook(id); saved = reading.get(book.contentId); applyReading(book);
    if (saved.conflicts.length) return { id, title: book.title, conflicts: saved.conflicts, revision: saved.revision };
    sessions.set(id, { clock: saved.clock, completed: saved.completed ?? book.completed ?? false, lastProgress: saved.unread ? undefined : saved.progress, contentId: book.contentId });
    book.pageCount = result.names.length; book.isNew = false; book.lastRead = Date.now(); state.lastBook = id; await save();
    const { identity, ...opened } = result; return { ...book, ...opened };
  });
  handle('info', (id, page) => rpc('info', { file: getBook(id).path, page }));
  handle('panels', (id, page, force = false) => rpc('panels', { file: getBook(id).path, page, settings: state.settings, force: !!force }));
  handle('savePanels', (id, page, panels) => rpc('savePanels', { file: getBook(id).path, page, panels }));
  handle('settings', async input => { state.settings = normalizeSettings(input); await save(); scheduleScan(); return state.settings; });
  handle('progress', async (id, progress) => {
    const book = getBook(id);
    if (!progress || !Number.isInteger(progress.page) || progress.page < 0 || progress.page >= (book.pageCount ?? 1) || !Number.isFinite(progress.panel) || !Number.isFinite(progress.offset)) throw new Error('Invalid reading position.');
    const session = sessions.get(id);
    if (!session || session.contentId !== book.contentId) throw new Error('Reopen the comic to save its position.');
    const position = { page: progress.page, panel: Math.max(0, Math.floor(progress.panel)), offset: Math.max(0, Math.min(1, progress.offset)), mode: ['page', 'guided', 'webtoon'].includes(progress.mode) ? progress.mode : 'page' };
    const completed = session.completed || (progress.ready !== false && readingComplete({ ...position, atEnd: progress.atEnd === true }, book.pageCount, progress.panelCount));
    if (JSON.stringify(position) === JSON.stringify(session.lastProgress) && completed === session.completed) return { progress: position, completed, readingRevision: reading.get(book.contentId).revision };
    const result = await reading.record(book.contentId, { progress: position, completed, pageCount: book.pageCount, clock: session.clock });
    session.clock = result.event.clock; session.completed = completed; session.lastProgress = position;
    book.progressSeeded = book.contentId; applyReading(book); await save(); void reading.sync();
    return { progress: position, completed, readingRevision: result.revision, readingConflicts: result.conflicts, lastRead: result.event.at };
  });
  handle('flushed', () => flushClose?.());
  handle('fullscreen', value => { window.setFullScreen(typeof value === 'boolean' ? value : !window.isFullScreen()); return window.isFullScreen(); });
  handle('quit', () => app.quit());
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 540, backgroundColor: '#111315', title: 'Panel Reader', autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  if (process.platform === 'win32' && app.isPackaged) {
    const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    window.setAppDetails({ appId, appIconPath: executable, relaunchCommand: `"${executable}"`, relaunchDisplayName: 'Panel Reader' });
  }
  window.setMenu(null);
  let closing = false;
  function requestClose() {
    if (flushClose) return;
    const timer = setTimeout(() => flushClose?.(), 2500);
    flushClose = () => { if (closing) return; closing = true; clearTimeout(timer); app.quit(); };
    emit('flush');
  }
  window.on('close', event => {
    if (closing) return;
    event.preventDefault(); requestClose();
  });
  window.on('focus', () => { void reading.sync(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('enter-full-screen', () => emit('fullscreen', true));
  window.on('leave-full-screen', () => emit('fullscreen', false));
  await window.loadURL(process.env.PANEL_READER_DEV || 'reader://app/');
  scheduleScan();
  syncTimer = setInterval(() => { void reading.sync(); }, 10000);
  void indexBooks(); void reading.sync();
  const initial = process.argv.filter(a => readableFile(a) && path.isAbsolute(a));
  if (initial.length) { try { const books = await addPaths(initial); emit('open', books[0].id); } catch (e) { emit('error', e.message); } }
  app.on('window-all-closed', () => app.quit());
  let finishing = false;
  app.on('before-quit', event => {
    if (finishing) return;
    if (!closing) { event.preventDefault(); requestClose(); return; }
    event.preventDefault(); finishing = true; clearInterval(scanTimer); clearInterval(syncTimer);
    scanController?.abort(); identityController?.abort();
    (async () => {
      await reading.flush(); await save();
      // Give the last bookmark a chance to publish, without holding shutdown
      // hostage to an unavailable network drive. The local outbox is durable.
      await Promise.race([(async () => { await reading.sync(); if (reading.syncedGeneration !== reading.generation) await reading.sync(); })(), new Promise(resolve => setTimeout(resolve, 1500))]);
    })().catch(console.error).finally(() => { worker?.terminate(); coverWorker?.terminate(); panelWorker?.terminate(); app.quit(); });
  });
  }).catch(error => { console.error(error); dialog.showErrorBox('Panel Reader could not start', error.message); app.exit(1); });
}
