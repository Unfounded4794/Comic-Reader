const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = (method, ...args) => ipcRenderer.invoke('reader:' + method, ...args);
contextBridge.exposeInMainWorld('reader', {
  state: () => invoke('state'),
  chooseSaveFolder: () => invoke('chooseSaveFolder'), savePage: (id, page) => invoke('savePage', id, page),
  favorite: id => invoke('favorite', id),
  chooseComic: () => invoke('chooseComic'), chooseFolder: () => invoke('chooseFolder'), chooseImages: () => invoke('chooseImages'),
  addPaths: files => invoke('addPaths', files), pathForFile: file => webUtils.getPathForFile(file),
  rescan: () => invoke('rescan'), removeFolder: folder => invoke('removeFolder', folder), changeFolder: folder => invoke('changeFolder', folder),
  open: id => invoke('open', id), info: (id, page) => invoke('info', id, page),
  panels: (id, page, force) => invoke('panels', id, page, force), savePanels: (id, page, panels) => invoke('savePanels', id, page, panels),
  settings: settings => invoke('settings', settings), progress: (id, progress) => invoke('progress', id, progress),
  fullscreen: value => invoke('fullscreen', value), quit: () => invoke('quit'),
  on: (event, callback) => {
    if (!['library', 'fullscreen', 'open', 'error'].includes(event)) return () => {};
    const handler = (_, data) => callback(data);
    ipcRenderer.on('reader:' + event, handler);
    return () => ipcRenderer.removeListener('reader:' + event, handler);
  },
});
