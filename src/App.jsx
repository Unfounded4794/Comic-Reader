import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ACTIONS, DEFAULT_SETTINGS, keyChord } from '../core/settings.mjs';
import { Button, Icon } from './icons.jsx';
import { Reader, imageUrl } from './Reader.jsx';
import { PanelEditor } from './PanelEditor.jsx';
import Preferences from './Preferences.jsx';
import { adjacentComic, booksInFolder, directBooksInFolder, findFolderNode, folderKey, folderTree, homeBooks, homeCollections, readingHistory, seriesContinuations } from '../core/catalog.mjs';
import { spatialTarget } from '../core/navigation.mjs';

function moveRemoteFocus(key) {
  const scope = document.querySelector('.modal-backdrop [role="dialog"]') ?? document.querySelector('.app');
  if (!scope) return false;
  let candidates = [...scope.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [role="button"][tabindex]')].filter(element => {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') return false;
    for (let parent = element; parent && parent !== scope; parent = parent.parentElement) {
      if (getComputedStyle(parent).opacity === '0' || parent.inert) return false;
    }
    return true;
  });
  if (!candidates.length) return false;
  const active = candidates.includes(document.activeElement) ? document.activeElement : null;
  if (!active) { candidates[0].focus(); return true; }
  const sidebar = active.closest('.sidebar');
  if (sidebar && (key === 'ArrowUp' || key === 'ArrowDown')) candidates = candidates.filter(element => sidebar.contains(element));
  if (sidebar && key === 'ArrowRight' && active.matches('.nav-item.active')) {
    // Enter the collection from the sidebar, without detouring through
    // unrelated management buttons or the file-opening toolbar.
    const content = candidates.filter(element => element.matches('.next-card, .folder-card, .book-card'));
    if (content.length) {
      content[0].focus({ preventScroll: true }); content[0].scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
  }
  if (active.matches('.collection-tabs button:first-child') && key === 'ArrowLeft') {
    const continuation = candidates.find(element => element.matches('.next-card'));
    if (continuation) {
      continuation.focus({ preventScroll: true }); continuation.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return true;
    }
  }
  const target = spatialTarget(active.getBoundingClientRect(), candidates.filter(element => element !== active).map(element => ({ element, rect: element.getBoundingClientRect() })), key);
  // The first collection may sit below the sidebar's Home row.
  const element = target?.element ?? (sidebar && key === 'ArrowRight' ? candidates.find(element => element.matches('.folder-card, .book-card')) : null);
  if (!element) return false;
  element.focus({ preventScroll: true }); element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  return true;
}
export default function App() {
  const [data, setData] = useState({ books: [], folders: [] }), [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [book, setBook] = useState(null), [page, setPage] = useState(0), [panel, setPanel] = useState(0), [info, setInfo] = useState(null), [panels, setPanels] = useState(null);
  const [view, setView] = useState('library'), [modal, setModal] = useState(null), [fullscreen, setFullscreen] = useState(false), [chrome, setChrome] = useState(true);
  const [search, setSearch] = useState(''), [sort, setSort] = useState('title'), [section, setSection] = useState('all'), [selectedFolder, setSelectedFolder] = useState(null), [zoom, setZoom] = useState(1);
  const [folderPending, setFolderPending] = useState(null);
  const [busy, setBusy] = useState(''), [detecting, setDetecting] = useState(false), [toast, setToast] = useState(null), [goto, setGoto] = useState('1'), [dragging, setDragging] = useState(false);
  const reader = useRef(), editor = useRef(), searchInput = useRef(), offset = useRef(0), openSerial = useRef(0), detectionSerial = useRef(0), toastTimer = useRef(), settingsSerial = useRef(0), latest = useRef(), lastSaved = useRef('');
  const notify = useCallback((message, error = false) => { setToast({ message: String(message), error }); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), error ? 10000 : 4500); }, []);
  const update = useCallback(next => {
    setSettings(next); const id = ++settingsSerial.current;
    window.reader.settings(next).then(value => { if (id === settingsSerial.current) setSettings(value); }).catch(e => notify(e.message, true));
  }, [notify]);
  const persistPosition = () => {
    const value = latest.current;
    if (!value?.book) return;
    const progress = { page: value.page, panel: Number.isFinite(value.panel) ? value.panel : 0, offset: offset.current };
    const key = value.book.id + JSON.stringify(progress);
    if (key === lastSaved.current) return Promise.resolve();
    lastSaved.current = key;
    return window.reader.progress(value.book.id, progress).then(() => setData(old => ({ ...old, books: old.books.map(b => b.id === value.book.id ? { ...b, progress, lastRead: Date.now() } : b) }))).catch(e => { lastSaved.current = ''; notify(e.message, true); });
  };
  const openBook = useCallback(async (id, entry = 'resume') => {
    const request = ++openSerial.current; await persistPosition(); setBusy('Opening comic…');
    try {
      const next = await window.reader.open(id); if (request !== openSerial.current) return;
      if (next.suggestedWebtoon && settings.mode !== 'webtoon') update({ ...settings, mode: 'webtoon' });
      const targetPage = entry === 'end' ? next.names.length - 1 : entry === 'start' ? 0 : Math.min(next.progress?.page ?? 0, next.names.length - 1);
      offset.current = entry === 'end' ? 1 : entry === 'start' ? 0 : next.progress?.offset ?? 0;
      setBook(next); setPage(targetPage); setPanel(entry === 'end' && settings.mode === 'guided' ? Infinity : entry === 'resume' ? next.progress?.panel ?? 0 : 0); setInfo(null); setPanels(null); setZoom(1); setView('reader'); setModal(null);
      document.activeElement?.blur();
      setData(old => ({ ...old, lastBook: id, books: old.books.map(b => b.id === id ? { ...b, ...next, names: undefined } : b) }));
    } catch (e) { notify(e.message, true); } finally { if (request === openSerial.current) setBusy(''); }
  }, [notify, settings, update]);
  useEffect(() => {
    if (!window.reader) { notify('Launch Panel Reader as a desktop app using npm start.', true); return; }
    window.reader.state().then(value => { setData(value); setSettings(value.settings); }).catch(e => notify(e.message, true));
    const cleanups = [window.reader.on('library', setData), window.reader.on('fullscreen', value => { setFullscreen(value); setChrome(!value); }), window.reader.on('open', openBook), window.reader.on('error', message => notify(message, true))];
    return () => cleanups.forEach(fn => fn());
  }, []);
  useEffect(() => {
    if (!book || view !== 'reader') return;
    let canceled = false; setInfo(null);
    window.reader.info(book.id, page).then(value => { if (!canceled) setInfo(value); }).catch(e => { if (!canceled) notify(e.message, true); });
    return () => { canceled = true; };
  }, [book?.id, page, view]);
  const detect = useCallback(async (force = false) => {
    if (!book) return;
    const token = ++detectionSerial.current; setDetecting(true); setPanels(null);
    try {
      const result = await window.reader.panels(book.id, page, force);
      if (token !== detectionSerial.current) return;
      setPanels(result); setPanel(p => p === Infinity ? result.panels.length - 1 : Math.min(p, result.panels.length - 1));
    } catch (e) { if (token === detectionSerial.current) notify(e.message, true); }
    finally { if (token === detectionSerial.current) setDetecting(false); }
  }, [book?.id, page, settings.detectionThreshold, settings.shapeDetection, settings.direction]);
  useEffect(() => {
    if (view === 'reader' && book && (settings.mode === 'guided' || modal === 'editor')) detect();
    return () => { ++detectionSerial.current; setDetecting(false); };
  }, [detect, settings.mode, view, modal === 'editor']);
  latest.current = { book, page, panel, view };
  useEffect(() => {
    if (!book || !Number.isFinite(panel)) return;
    const timer = setTimeout(persistPosition, 300); return () => clearTimeout(timer);
  }, [book?.id, page, panel]);
  useEffect(() => { const timer = setInterval(persistPosition, 2000); const unload = () => persistPosition(); window.addEventListener('beforeunload', unload); return () => { clearInterval(timer); window.removeEventListener('beforeunload', unload); }; }, []);
  const trees = folderTree(data.folders, data.books), homeFolders = homeCollections(trees), looseBooks = homeBooks(trees, data.books);
  const folderSelectionBooks = section === 'folder' ? directBooksInFolder(data.books, selectedFolder) : section === 'all' ? looseBooks : data.books;
  const sectionBooks = search ? data.books : section === 'new' ? folderSelectionBooks.filter(b => b.isNew) : section === 'history' ? readingHistory(folderSelectionBooks) : folderSelectionBooks;
  const books = sectionBooks.filter(b => `${b.title} ${b.path}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'recent' || section === 'history' ? (b.lastRead ?? 0) - (a.lastRead ?? 0) : sort === 'added' ? b.added - a.added : a.title.localeCompare(b.title, undefined, { numeric: true }));
  const nextComic = (delta, boundary = false) => {
    if (busy) return;
    const target = adjacentComic(data.books, book, delta);
    if (target) openBook(target.id, boundary ? delta < 0 ? 'end' : 'start' : 'resume'); else notify(delta > 0 ? 'You’re at the last comic in this series.' : 'You’re at the first comic in this series.');
  };
  const go = target => {
    if (!book) return;
    if (busy) return;
    if (target >= book.names.length) { if (settings.autoNextComic) nextComic(1, true); else notify('End of this comic.'); return; }
    if (target < 0) { if (settings.autoNextComic) nextComic(-1, true); else notify('Beginning of this comic.'); return; }
    offset.current = 0; setPanel(0);
    if (settings.mode === 'webtoon') reader.current?.goToPage(target);
    setPage(target);
  };
  const turn = delta => {
    if (!book || view !== 'reader') return;
    if (settings.mode === 'guided') {
      if (detecting || !panels) return;
      if (panel + delta >= 0 && panel + delta < panels.panels.length) { setPanel(panel + delta); return; }
      if (delta < 0 && page > 0) { go(page - 1); setPanel(Infinity); return; }
    }
    go(page + delta);
  };
  const choose = async kind => { try { const values = await window.reader[kind](); if (values?.length) openBook(values[0].id); } catch (e) { notify(e.message, true); } };
  const scan = async add => { setBusy(add ? 'Finding comics…' : 'Rescanning library…'); try { const result = await window.reader[add ? 'chooseFolder' : 'rescan'](); if (result) notify(`${result.added} new comic${result.added === 1 ? '' : 's'} found.${result.errors.length ? ` ${result.errors.length} folder/file(s) unavailable.` : ''}`, result.errors.length > 0); } catch (e) { notify(e.message, true); } finally { setBusy(''); } };
  const setMode = mode => { update({ ...settings, mode }); setZoom(1); };
  const setFit = fit => {
    if (settings.mode === 'guided') return;
    update({ ...settings, fit });
    if (settings.mode === 'webtoon' && fit === 'height') {
      const steps = [.75, .5, .33];
      setZoom(current => settings.fit !== 'height' ? steps[0] : steps.find(value => value < current - .02) ?? steps[0]);
    } else setZoom(1);
  };
  const run = id => {
    if (id.startsWith('editor')) { editor.current?.action(id); return; }
    const handlers = {
      openFile: () => choose('chooseComic'), openImages: () => choose('chooseImages'), addFolder: () => scan(true), rescan: () => scan(false),
      library: () => { persistPosition(); setView(view === 'library' && book ? 'reader' : 'library'); }, settings: () => setModal('settings'),
      next: () => turn(1), previous: () => turn(-1), nextPage: () => go(page + 1), previousPage: () => go(page - 1), first: () => go(0), last: () => go(book.names.length - 1),
      goToPage: () => { setGoto(String(page + 1)); setModal('goto'); },
      scrollDown: () => reader.current?.scroll(0, settings.scrollAmount), scrollUp: () => reader.current?.scroll(0, -settings.scrollAmount),
      scrollLeft: () => reader.current?.scroll(-settings.scrollAmount, 0), scrollRight: () => reader.current?.scroll(settings.scrollAmount, 0),
      fitPage: () => setFit('page'), fitWidth: () => setFit('width'), fitHeight: () => setFit('height'), actualSize: () => setFit('actual'),
      zoomIn: () => setZoom(z => Math.min(12, z * 1.15)), zoomOut: () => setZoom(z => Math.max(.1, z / 1.15)),
      fullscreen: () => window.reader.fullscreen(), exitFullscreen: () => { if (modal) setModal(null); else if (fullscreen) window.reader.fullscreen(false); else setChrome(true); },
      toggleChrome: () => setChrome(c => !c), counter: () => update({ ...settings, showCounter: !settings.showCounter }),
      guided: () => setMode(settings.mode === 'guided' ? 'page' : 'guided'), webtoon: () => setMode(settings.mode === 'webtoon' ? 'page' : 'webtoon'),
      editPanels: () => setModal('editor'), redetect: () => { if (panels?.manual) setModal('redetect'); else detect(true); },
      nextComic: () => nextComic(1), previousComic: () => nextComic(-1), toggleDirection: () => update({ ...settings, direction: settings.direction === 'ltr' ? 'rtl' : 'ltr' }),
      background: () => setModal('background'), search: () => { setView('library'); setTimeout(() => searchInput.current?.focus(), 0); },
      sortLibrary: () => setSort(s => ({ title: 'recent', recent: 'added', added: 'title' }[s])), newOnly: () => setSection(value => value === 'new' ? 'all' : 'new'),
      resetShortcuts: () => update({ ...settings, shortcuts: { ...DEFAULT_SETTINGS.shortcuts } }), quit: () => { persistPosition()?.finally(() => window.reader.quit()); if (!book) window.reader.quit(); },
    };
    handlers[id]?.();
  };
  useLayoutEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || event.isComposing) return;
      // Enter activates the focused control. Arrow keys use spatial focus in
      // the library and dialogs, and while a reader control has focus.
      if (event.key === 'Enter' && event.target.closest?.('button,[role="button"]')) return;
      if (event.key === 'Enter' && view === 'reader' && !modal) {
        event.preventDefault();
        document.querySelector('.reader-title button:not(:disabled)')?.focus({ preventScroll: true });
        return;
      }
      const libraryField = event.target.matches?.('input[aria-label="Search comics"], select[aria-label="Sort comics"]');
      if (event.target.closest('input,textarea,select,[contenteditable="true"]') && !(libraryField && /^Arrow/.test(event.key))) return;
      if (!event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && /^Arrow/.test(event.key) && (view === 'library' || modal || event.target.closest?.('button,[role="button"]'))) {
        event.preventDefault();
        moveRemoteFocus(event.key);
        return;
      }
      const chord = keyChord(event);
      let action = ACTIONS.find(([id]) => settings.shortcuts[id] && settings.shortcuts[id] === chord)?.[0];
      // Manga advances through panels and pages with Left and goes back with
      // Right. Other configured shortcuts retain their semantic actions.
      if (settings.direction === 'rtl' && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && view === 'reader' && !modal) {
        if (event.key === 'ArrowLeft') action = 'next';
        else if (event.key === 'ArrowRight') action = 'previous';
      }
      if (!action) return;
      if (modal && !['exitFullscreen', 'resetShortcuts'].includes(action) && !(modal === 'editor' && action.startsWith('editor'))) return;
      if (!book && ['next','previous','nextPage','previousPage','first','last','goToPage','editPanels','redetect'].includes(action)) return;
      event.preventDefault(); if (event.repeat && !['scrollDown','scrollUp','scrollLeft','scrollRight','zoomIn','zoomOut'].includes(action)) return;
      run(action);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body && document.activeElement.isConnected) return;
      const selector = modal ? '.modal-backdrop [role="dialog"] button:not(:disabled)' : view === 'reader' ? null : section === 'folder' ? '.folder-up' : '.nav-item.active';
      if (selector) document.querySelector(selector)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [view, modal, section, selectedFolder?.root, selectedFolder?.relative]);
  const title = id => `${ACTIONS.find(([a]) => a === id)?.[1] ?? id}${settings.shortcuts[id] ? ` (${settings.shortcuts[id]})` : ''}`;
  const actionButton = (id, icon, label, extra = {}) => <Button icon={icon} title={title(id)} aria-label={ACTIONS.find(([a]) => a === id)?.[1]} onClick={() => run(id)} {...extra}>{label}</Button>;
  const showChrome = view === 'library' || chrome;
  const continuations = seriesContinuations(data.books).slice(0, 10), selectedNode = findFolderNode(trees, selectedFolder);
  const homeCount = homeFolders.length + looseBooks.length;
  const browseFolders = search || !['all', 'folder'].includes(section) ? [] : section === 'all' ? homeFolders : selectedNode?.children ?? [];
  const viewCount = section === 'folder' ? selectedNode?.count ?? 0 : section === 'all' ? data.books.length : books.length;
  const selectCollection = value => { setSection(value); if (value !== 'folder') setSelectedFolder(null); };
  const selectFolder = node => { setSelectedFolder({ root: node.root, relative: node.relative, path: node.path, name: node.name }); setSection('folder'); setSearch(''); };
  const goUpFolder = () => {
    if (!selectedNode?.relative) { selectCollection('all'); return; }
    const parts = selectedNode.relative.split('/'); parts.pop();
    const parent = findFolderNode(trees, { root: selectedNode.root, relative: parts.join('/') });
    if (parent) selectFolder(parent); else selectCollection('all');
  };
  const changeFolder = async folder => {
    try { const result = await window.reader.changeFolder(folder); if (result) notify(`Folder updated. ${result.added} new comic${result.added === 1 ? '' : 's'} found.`); }
    catch (error) { notify(error.message, true); }
  };
  const removeFolder = async folder => {
    try { await window.reader.removeFolder(folder); if (selectedFolder && folderKey(selectedFolder.root) === folderKey(folder)) selectCollection('all'); notify('Library folder removed. Your comic files were not changed.'); }
    catch (error) { notify(error.message, true); }
    finally { setFolderPending(null); setModal(null); }
  };
  return <div className={`app ${fullscreen ? 'fullscreen' : ''} ${!showChrome ? 'immersive' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={async e => {
    e.preventDefault(); setDragging(false);
    try { const paths = [...e.dataTransfer.files].map(f => window.reader.pathForFile(f)).filter(Boolean); if (paths.length) { const values = await window.reader.addPaths(paths); openBook(values[0].id); } } catch (error) { notify(error.message, true); }
  }}>
    {view === 'library' ? <>
      <aside className="sidebar"><div className="brand"><div className="brand-mark"><i/><i/><i/></div><span>Panel<span className="brand-light">Reader</span></span></div>
        <div className="sidebar-label">COLLECTION</div><button className={`nav-item ${section === 'all' ? 'active' : ''}`} onClick={() => selectCollection('all')}><Icon name="library"/>Home<span>{homeCount}</span></button>
        <button className={`nav-item ${section === 'new' ? 'active' : ''}`} onClick={() => selectCollection('new')}><Icon name="plus"/>Newly added<span>{data.books.filter(b => b.isNew).length}</span></button>
        <button className={`nav-item ${section === 'history' ? 'active' : ''}`} onClick={() => selectCollection('history')}><Icon name="clock"/>History<span>{readingHistory(data.books).length}</span></button>
        <div className="sidebar-label folder-label">LIBRARY FOLDERS<button title={title('addFolder')} aria-label="Add library folder" onClick={() => scan(true)}>+</button></div>
        <div className="folder-list">{trees.map(node => <FolderNode key={node.key} node={node} selection={selectedFolder} active={section === 'folder'} onSelect={selectFolder} onChange={folder => changeFolder(folder)} onRemove={folder => { setFolderPending(folder); setModal('removeFolder'); }}/>) }{!data.folders.length && <p>Add a folder to keep your<br/>collection in sync.</p>}</div>
        <button className="sidebar-scan" onClick={() => scan(false)} disabled={!!busy}><Icon name="refresh" size={16}/>{busy || 'Rescan folders'}</button>
        <div className="sidebar-bottom"><div className="local-badge"><span/>Local. Offline. Yours.</div>{actionButton('settings', 'settings', 'Preferences')}</div>
      </aside>
      <main className="library-main"><header className="library-top"><div className="breadcrumb">COLLECTION <span>/</span> {section === 'new' ? 'NEWLY ADDED' : section === 'history' ? 'READING HISTORY' : section === 'folder' ? selectedFolder?.name?.toUpperCase() : 'HOME'}</div><div className="button-row">{actionButton('openImages', 'webtoon', 'Image folder')}{actionButton('openFile', 'open', 'Open comic / image')}{actionButton('addFolder', 'plus', 'Add folder', { className: 'primary' })}</div></header>
        <div className={`library-content ${section === 'all' ? 'home-content' : ''}`}>{section !== 'all' && <div className="library-title"><div><span className="eyebrow">{section === 'folder' ? 'BROWSING FOLDER' : section === 'history' ? 'WHERE YOU HAVE BEEN' : 'NEW TO YOUR LIBRARY'}</span><div className="folder-title-line">{section === 'folder' && <button className="folder-up" onClick={goUpFolder} aria-label="Go up one folder"><Icon name="previous" size={19}/></button>}<h1>{section === 'folder' ? selectedFolder?.name : section === 'history' ? 'Reading history' : 'Newly added'}<span>.</span></h1></div><p>{viewCount ? `${viewCount} comic${viewCount === 1 ? '' : 's'}${section === 'folder' ? ' in this folder tree' : ' in this view'}.` : 'No comics in this view yet.'}</p></div><div className="format-tags"><span>CBZ</span><span>CBR</span><span>JPG</span><span>PNG</span><span>WEBTOON</span></div></div>}
          {!!continuations.length && !search && section === 'all' && <section className="up-next"><div className="shelf-heading"><div><span className="eyebrow">YOUR ACTIVE SERIES</span><h2>Continue reading</h2></div><span>{continuations.length} series</span></div><div className="up-next-grid">{continuations.map(item => <button key={`${folderKey(item.next.folder)}:${item.next.id}`} className="next-card" onClick={() => openBook(item.next.id)}><img src={imageUrl(item.next.id, 0, 'cover')} alt=""/><div><span>{item.series}</span><strong>{item.next.title}</strong><small>{item.resume ? `Page ${(item.next.progress?.page ?? 0) + 1}${item.next.pageCount ? ` of ${item.next.pageCount}` : ''}` : `After ${item.previous.title}`}</small></div><Icon name="arrow" size={17}/></button>)}</div></section>}
          <div className="library-controls"><div className="collection-tabs"><button className={section === 'all' ? 'active' : ''} onClick={() => selectCollection('all')}>Home <span>{homeCount}</span></button><button className={section === 'new' ? 'active' : ''} onClick={() => selectCollection('new')}>Newly added <span>{data.books.filter(b => b.isNew).length}</span></button><button className={section === 'history' ? 'active' : ''} onClick={() => selectCollection('history')}>History <span>{readingHistory(data.books).length}</span></button>{section === 'folder' && <button className="active">{selectedFolder?.name} <span>{selectedNode?.count ?? 0}</span></button>}</div><div className="button-row"><label className="search"><Icon name="search" size={17}/><input ref={searchInput} aria-label="Search comics" placeholder="Search every folder…" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Sort comics" value={sort} onChange={e => setSort(e.target.value)}><option value="title">Title A–Z</option><option value="recent">Last read</option><option value="added">Recently added</option></select></div></div>
          {!!browseFolders.length && <section className="folder-browser"><div className="shelf-heading"><div><span className="eyebrow">{section === 'all' ? 'YOUR LIBRARY FOLDERS' : 'INSIDE THIS FOLDER'}</span><h2>Folders</h2></div><span>{browseFolders.length} folder{browseFolders.length === 1 ? '' : 's'}</span></div><div className="folder-card-grid">{browseFolders.map(node => <FolderCard key={node.key} node={node} books={booksInFolder(data.books, node)} onOpen={() => selectFolder(node)}/>)}</div></section>}
          {books.length ? <><div className="issue-heading"><span>{search ? 'Search results' : section === 'all' ? 'Loose comics and images' : section === 'folder' ? 'Comics in this folder' : section === 'history' ? 'Previously read' : 'New comics'}</span><small>{books.length}</small></div><div className="book-grid">{books.map(b => <button className={`book-card ${b.missing ? 'missing' : ''}`} key={b.id} onClick={() => openBook(b.id)} title={b.path}><div className="cover"><img loading="lazy" src={imageUrl(b.id, 0, 'cover')} alt={`Cover of ${b.title}`} onError={e => { e.currentTarget.style.opacity = 0; }}/><div className="cover-fallback"><Icon name="book" size={44}/></div>{b.isNew && <span className="new-badge">NEW</span>}<span className="cover-play"><Icon name="open"/>Read comic</span>{b.progress && <div className="reading-progress" style={{ width: `${((b.progress.page + 1) / (b.pageCount || 1)) * 100}%` }}/>}</div><h3>{b.title}</h3><div className="book-meta"><span>{b.format}</span><span>{b.missing ? 'Unavailable' : b.progress ? `Page ${b.progress.page + 1} / ${b.pageCount}` : 'Unread'}</span></div></button>)}</div></> : !browseFolders.length && <div className="empty-library"><div className="empty-art"><div/><div/><Icon name="book" size={64}/></div><h2>{data.books.length ? 'No comics match this view.' : 'Your next story starts here.'}</h2><p>{data.books.length ? 'Try another search or choose another folder.' : 'Add a comics folder, open an archive, or drop a JPG or PNG here.'}</p>{!data.books.length && <div className="button-row">{actionButton('addFolder', 'folder', 'Choose a folder', { className: 'primary' })}{actionButton('openFile', 'open', 'Open a comic or image')}</div>}<div className="empty-features"><span><Icon name="panels" size={17}/>Guided panel reading</span><span><Icon name="webtoon" size={17}/>Continuous webtoons</span><span><Icon name="keyboard" size={17}/>Your own shortcuts</span></div></div>}
        </div><footer className="library-footer"><span>Made for the art. Built for the reader.</span><span>Panel Reader <b>0.3.3</b></span></footer>
      </main>
    </> : <main className="reader-main">
      {showChrome && <header className="reader-toolbar"><div className="reader-title">{actionButton('library', 'library')}<div><strong title={book?.title}>{book?.title}</strong><span>{book?.format} <i>·</i> {settings.mode === 'guided' ? `Guided panels · ${settings.direction === 'rtl' ? 'Manga' : 'Left to right'}` : settings.mode === 'webtoon' ? 'Continuous scroll' : settings.direction === 'rtl' ? 'Page view · Manga' : 'Page view'}</span></div></div><div className="reader-tools"><div className="segmented">{actionButton('fitPage','fit',null,{ className: settings.mode === 'guided' || settings.fit === 'page' ? 'active' : '', disabled: settings.mode === 'guided' })}{actionButton('fitWidth','width',null,{ className: settings.mode !== 'guided' && settings.fit === 'width' ? 'active' : '', disabled: settings.mode === 'guided' })}{actionButton('fitHeight','height',null,{ className: settings.mode !== 'guided' && settings.fit === 'height' ? 'active' : '', disabled: settings.mode === 'guided' })}</div><div className="tool-divider"/>{actionButton('guided','panels',null,{ className: settings.mode === 'guided' ? 'active' : '' })}{actionButton('webtoon','webtoon',null,{ className: settings.mode === 'webtoon' ? 'active' : '' })}{actionButton('toggleDirection','manga',null,{ className: settings.direction === 'rtl' ? 'active' : '' })}{actionButton('editPanels','edit')}<div className="tool-divider"/>{actionButton('settings','settings')}{actionButton('fullscreen','fullscreen')}</div></header>}
      {book && <Reader key={book.id} ref={reader} book={{ ...book, progress: { page, offset: offset.current } }} page={page} info={info} panels={panels} panel={panel} settings={settings} zoom={zoom} onPage={target => { if (target !== page) { setPanel(0); setPanels(null); setPage(target); } }} onOffset={value => { offset.current = value; }} onError={message => notify(message, true)}/>}
      {showChrome && <footer className="reader-footer"><div className="reader-status">{detecting ? <><span className="spinner small"/>Finding panels…</> : settings.mode === 'guided' ? <><span className="status-dot"/>{panels?.manual ? 'Your panel layout' : panels?.fallback ? 'Whole page' : `${panels?.panels.length ?? '…'} panels detected`}</> : <span>{settings.direction === 'ltr' ? 'Left to right' : 'Manga · right to left'} <i>·</i> {settings.mode === 'webtoon' ? 'Continuous scroll' : 'Drag to pan'}</span>}</div><div className="page-navigation">{settings.direction === 'rtl' ? actionButton('next','previous',null,{ title: 'Next page / panel (ArrowLeft)', disabled: detecting && settings.mode === 'guided' }) : actionButton('previous','previous',null,{ disabled: detecting && settings.mode === 'guided' })}{settings.showCounter && <button className="page-count" title={title('goToPage')} onClick={() => run('goToPage')}>Page <strong>{page + 1}</strong> / {book?.names.length}{settings.mode === 'guided' && panels && <span> · Panel {Number.isFinite(panel) ? panel + 1 : '…'} / {panels.panels.length}</span>}</button>}{settings.direction === 'rtl' ? actionButton('previous','next',null,{ title: 'Previous page / panel (ArrowRight)', disabled: detecting && settings.mode === 'guided' }) : actionButton('next','next',null,{ disabled: detecting && settings.mode === 'guided' })}</div><div className="zoom-tools">{actionButton('zoomOut','minus')}<span>{Math.round(zoom * 100)}%</span>{actionButton('zoomIn','plus')}</div></footer>}
    </main>}
    {(modal === 'settings' || modal === 'background') && <Preferences key={modal} settings={settings} update={update} folders={data.folders} onChangeFolder={changeFolder} onRemoveFolder={folder => { setFolderPending(folder); setModal('removeFolder'); }} onClose={() => setModal(null)}/>}
    {modal === 'editor' && panels && <PanelEditor key={`${book.id}-${page}`} ref={editor} book={book} page={page} result={panels} onSave={async corrections => { const result = await window.reader.savePanels(book.id, page, corrections); setPanels(result); setPanel(0); setModal(null); notify('Panel layout saved.'); }} onClose={() => setModal(null)} onError={message => notify(message, true)}/>}
    {modal === 'editor' && !panels && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-label="Loading panel editor"><h2>{detecting ? 'Finding panels…' : 'Could not detect panels'}</h2><p>{detecting ? 'Preparing the editable page layout.' : 'You can draw the page layout yourself.'}</p><div className="button-row"><Button onClick={() => setModal(null)}>Cancel</Button>{!detecting && info && <Button onClick={() => setPanels({ ...info, panels: [{ x: 0, y: 0, w: 1, h: 1, polygon: [[0,0],[1,0],[1,1],[0,1]] }] })}>Draw manually</Button>}</div></section></div>}
    {modal === 'goto' && <div className="modal-backdrop"><form className="modal small-modal" role="dialog" aria-label="Go to page" onSubmit={e => { e.preventDefault(); const value = Number(goto); if (Number.isInteger(value) && value >= 1 && value <= book.names.length) { go(value - 1); setModal(null); } }}><h2>Go to page</h2><p>Choose a page from 1 to {book.names.length}.</p><input autoFocus aria-label="Page number" type="number" min={1} max={book.names.length} value={goto} onChange={e => setGoto(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setModal(null); }}/><footer><Button type="button" onClick={() => setModal(null)}>Cancel</Button><Button className="primary" type="submit">Go to page</Button></footer></form></div>}
    {modal === 'redetect' && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-label="Replace saved panels"><h2>Replace this page’s corrections?</h2><p>Detecting again replaces your saved outlines and reading order for this page.</p><footer><Button onClick={() => setModal(null)}>Keep corrections</Button><Button className="primary" onClick={() => { setModal(null); detect(true); }}>Detect again</Button></footer></section></div>}
    {modal === 'removeFolder' && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-label="Remove library folder"><h2>Remove this library folder?</h2><p><strong>{folderPending?.split(/[\\/]/).filter(Boolean).at(-1)}</strong> and its scanned comics will disappear from this library. Your comic files will stay untouched.</p><footer><Button onClick={() => { setFolderPending(null); setModal(null); }}>Cancel</Button><Button className="danger" onClick={() => removeFolder(folderPending)}>Remove folder</Button></footer></section></div>}
    {toast && showChrome && <div role="status" className={`toast ${toast.error ? 'error' : ''}`}><Icon name={toast.error ? 'close' : 'check'} size={18}/><span>{toast.message}</span><button aria-label="Dismiss message" onClick={() => setToast(null)}>×</button></div>}
    {busy && view === 'reader' && showChrome && <div className="busy-label"><span className="spinner small"/>{busy}</div>}
    {dragging && <div className="drop-overlay"><Icon name="book" size={60}/><h2>Drop into your next story.</h2><p>CBZ · CBR · ZIP · RAR · JPG · PNG · Image folders</p></div>}
  </div>;
}

function FolderNode({ node, selection, active, onSelect, onChange, onRemove }) {
  const selected = active && selection && folderKey(selection.root) === folderKey(node.root);
  return <div className="folder-branch"><div className={`folder-row ${selected ? 'active' : ''}`} style={{ '--folder-depth': 0 }} title={node.path}>
    <button className="folder-select" onClick={() => onSelect(node)}><Icon name="folder" size={16}/><span>{node.name}</span><small>{node.count}</small></button>
    <span className="folder-actions"><button aria-label={`Change ${node.name} folder`} title="Change folder location" onClick={() => onChange(node.root)}><Icon name="edit" size={13}/></button><button aria-label={`Remove ${node.name} folder`} title="Remove library folder" onClick={() => onRemove(node.root)}><Icon name="trash" size={13}/></button></span>
  </div></div>;
}

function FolderCard({ node, books, onOpen }) {
  const covers = books.filter(book => !book.missing).slice(0, 3);
  return <button className="folder-card" onClick={onOpen} title={node.path}><div className="folder-card-covers">{covers.map((book, index) => <img key={book.id} style={{ '--cover-index': index }} src={imageUrl(book.id, 0, 'cover')} alt=""/>)}{!covers.length && <Icon name="folder" size={38}/>}</div><div className="folder-card-copy"><span>{node.children.length ? `${node.children.length} subfolder${node.children.length === 1 ? '' : 's'}` : 'Series folder'}</span><strong>{node.name}</strong><small>{node.count} comic{node.count === 1 ? '' : 's'}</small></div><Icon name="arrow" size={18}/></button>;
}
