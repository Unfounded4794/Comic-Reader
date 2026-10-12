import { app, BrowserWindow, dialog, ipcMain, protocol, net, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { scanFolders, bookId } from '../core/library.mjs';
import { COMIC_RE, IMAGE_RE } from '../core/archive.mjs';
import { normalizeSettings } from '../core/settings.mjs';
import { saveOriginalPage } from '../core/page-export.mjs';
const appId = 'org.panelreader.desktop';
if (process.platform === 'win32') app.setAppUserModelId(appId);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pathKey = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const readableFile = value => COMIC_RE.test(value) || IMAGE_RE.test(value);
if (process.env.PANEL_READER_DATA) app.setPath('userData', path.resolve(process.env.PANEL_READER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'comic', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'reader', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
let window, worker, scanTimer, scanning, state = { folders: [], books: [], settings: normalizeSettings(), lastBook: null };
let saveQueue = Promise.resolve(); let serial = 0; const calls = new Map();
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
  if (!worker) return Promise.reject(new Error('The reader engine is not running. Restart the app.'));
  const id = ++serial;
  return new Promise((resolve, reject) => { calls.set(id, { resolve, reject }); worker.postMessage({ id, method, args }); });
}
function getBook(id) { const book = state.books.find(b => b.id === id); if (!book) throw new Error('Comic is not in the library.'); return book; }
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
  await save(); emit('library', state); return added;
}
async function rescan() {
  if (scanning) return scanning;
  scanning = (async () => {
    const snapshot = state.books;
    const result = await scanFolders([...state.folders], snapshot);
    // Progress or separately opened books can change while the disk scan is running.
    const current = new Map(state.books.map(b => [b.id, b]));
    state.books = result.books.map(b => { const latest = current.get(b.id); current.delete(b.id); return latest ? { ...b, progress: latest.progress, isNew: latest.isNew, lastRead: latest.lastRead, favorite: latest.favorite } : b; });
    state.books.push(...current.values());
    await save(); emit('library', state); return { ...result, books: state.books };
  })().finally(() => { scanning = null; });
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
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { models: app.isPackaged ? path.join(process.resourcesPath, 'models') : path.join(root, 'models'), cache: path.join(app.getPath('userData'), 'cache') } });
  worker.on('message', ({ id, result, error }) => { const call = calls.get(id); if (!call) return; calls.delete(id); error ? call.reject(new Error(error)) : call.resolve(result); });
  worker.on('error', e => { for (const call of calls.values()) call.reject(e); calls.clear(); emit('error', e.message); });
  worker.on('exit', code => { worker = null; for (const call of calls.values()) call.reject(new Error(`Reader engine exited (${code}). Restart the app.`)); calls.clear(); });
  protocol.handle('comic', async request => {
    try {
      const url = new URL(request.url), match = url.pathname.match(/^\/([a-f0-9]{24})\/(\d+)\/(image|cover|tile\/(\d+))$/);
      if (url.hostname !== 'book' || !match) return new Response('', { status: 404 });
      const book = getBook(match[1]), page = Number(match[2]);
      const result = await rpc('image', { file: book.path, page, thumbnail: match[3] === 'cover', tile: match[4] === undefined ? undefined : Number(match[4]) });
      return new Response(result.bytes, { headers: { 'Content-Type': result.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
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
  handle('chooseSaveFolder', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose a folder for saved pages', defaultPath: state.settings.savePageFolder || undefined, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('savePage', async (id, page) => {
    const book = getBook(id);
    const original = await rpc('original', { file: book.path, page });
    return saveOriginalPage({ ...original, title: book.title, folder: state.settings.savePageFolder });
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
    await save(); return rescan();
  });
  handle('addPaths', addPaths);
  handle('changeFolder', async folder => {
    if (typeof folder !== 'string' || !state.folders.some(value => pathKey(value) === pathKey(folder))) throw new Error('Library folder is no longer available.');
    if (scanning) await scanning;
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
    if (scanning) await scanning;
    state.folders = state.folders.filter(value => pathKey(value) !== pathKey(folder));
    state.books = state.books.filter(book => !book.root || pathKey(book.root) !== pathKey(folder));
    await save(); emit('library', state); return state;
  });
  handle('rescan', rescan);
  handle('open', async id => {
    const book = getBook(id), result = await rpc('open', { file: book.path });
    book.pageCount = result.names.length; book.isNew = false; book.lastRead = Date.now(); state.lastBook = id; await save();
    return { ...book, ...result };
  });
  handle('info', (id, page) => rpc('info', { file: getBook(id).path, page }));
  handle('panels', (id, page, force = false) => rpc('panels', { file: getBook(id).path, page, settings: state.settings, force: !!force }));
  handle('savePanels', (id, page, panels) => rpc('savePanels', { file: getBook(id).path, page, panels }));
  handle('settings', async input => { state.settings = normalizeSettings(input); await save(); scheduleScan(); return state.settings; });
  handle('progress', async (id, progress) => {
    const book = getBook(id);
    if (!progress || !Number.isInteger(progress.page) || progress.page < 0 || progress.page >= (book.pageCount ?? 1) || !Number.isFinite(progress.panel) || !Number.isFinite(progress.offset)) throw new Error('Invalid reading position.');
    book.progress = { page: progress.page, panel: Math.max(0, Math.floor(progress.panel)), offset: Math.max(0, Math.min(1, progress.offset)) }; book.lastRead = Date.now(); await save();
  });
  handle('fullscreen', value => { window.setFullScreen(typeof value === 'boolean' ? value : !window.isFullScreen()); return window.isFullScreen(); });
  handle('quit', () => app.quit());
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 540, backgroundColor: '#111315', title: 'Panel Reader', autoHideMenuBar: true, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } });
  if (process.platform === 'win32' && app.isPackaged) {
    const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
    window.setAppDetails({ appId, appIconPath: executable, relaunchCommand: `"${executable}"`, relaunchDisplayName: 'Panel Reader' });
  }
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('enter-full-screen', () => emit('fullscreen', true));
  window.on('leave-full-screen', () => emit('fullscreen', false));
  await window.loadURL(process.env.PANEL_READER_DEV || 'reader://app/');
  scheduleScan();
  const initial = process.argv.filter(a => readableFile(a) && path.isAbsolute(a));
  if (initial.length) { try { const books = await addPaths(initial); emit('open', books[0].id); } catch (e) { emit('error', e.message); } }
  app.on('window-all-closed', () => app.quit());
  let finishing = false;
  app.on('before-quit', event => {
    if (finishing) return;
    event.preventDefault(); finishing = true; clearInterval(scanTimer);
    save().catch(console.error).finally(() => { worker?.terminate(); app.quit(); });
  });
  }).catch(error => { console.error(error); dialog.showErrorBox('Panel Reader could not start', error.message); app.exit(1); });
}
