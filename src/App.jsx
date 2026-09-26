import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIONS, DEFAULT_SETTINGS, keyChord } from '../core/settings.mjs';
import { Button, Icon } from './icons.jsx';
import { Reader, imageUrl } from './Reader.jsx';
import { PanelEditor } from './PanelEditor.jsx';
import Preferences from './Preferences.jsx';
export default function App() {
  const [data, setData] = useState({ books: [], folders: [] }), [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [book, setBook] = useState(null), [page, setPage] = useState(0), [panel, setPanel] = useState(0), [info, setInfo] = useState(null), [panels, setPanels] = useState(null);
  const [view, setView] = useState('library'), [modal, setModal] = useState(null), [fullscreen, setFullscreen] = useState(false), [chrome, setChrome] = useState(true);
  const [search, setSearch] = useState(''), [sort, setSort] = useState('title'), [newOnly, setNewOnly] = useState(false), [zoom, setZoom] = useState(1);
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
  const openBook = useCallback(async id => {
    const request = ++openSerial.current; await persistPosition(); setBusy('Opening comic…');
    try {
      const next = await window.reader.open(id); if (request !== openSerial.current) return;
      setBook(next); setPage(Math.min(next.progress?.page ?? 0, next.names.length - 1)); setPanel(next.progress?.panel ?? 0); setInfo(null); setPanels(null); setZoom(1); setView('reader'); setModal(null); offset.current = next.progress?.offset ?? 0;
      setData(old => ({ ...old, lastBook: id, books: old.books.map(b => b.id === id ? { ...b, ...next, names: undefined } : b) }));
    } catch (e) { notify(e.message, true); } finally { if (request === openSerial.current) setBusy(''); }
  }, [notify]);
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
  const books = data.books.filter(b => !newOnly || b.isNew).filter(b => `${b.title} ${b.path}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === 'recent' ? (b.lastRead ?? 0) - (a.lastRead ?? 0) : sort === 'added' ? b.added - a.added : a.title.localeCompare(b.title, undefined, { numeric: true }));
  const nextComic = delta => { const all = data.books.filter(b => !b.missing).sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })); const index = all.findIndex(b => b.id === book?.id); const target = all[index + delta]; if (target) openBook(target.id); else notify(delta > 0 ? 'You’re at the last comic in your library.' : 'You’re at the first comic in your library.'); };
  const go = target => {
    if (!book) return;
    if (target >= book.names.length) { if (settings.autoNextComic) nextComic(1); else notify('End of this comic.'); return; }
    if (target < 0) { notify('Beginning of this comic.'); return; }
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
  const setMode = mode => { update({ ...settings, mode }); setZoom(1); setPanel(0); };
  const setFit = fit => { update({ ...settings, [settings.mode === 'guided' ? 'panelFit' : 'fit']: fit }); setZoom(1); };
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
      sortLibrary: () => setSort(s => ({ title: 'recent', recent: 'added', added: 'title' }[s])), newOnly: () => setNewOnly(v => !v),
      resetShortcuts: () => update({ ...settings, shortcuts: { ...DEFAULT_SETTINGS.shortcuts } }), quit: () => { persistPosition()?.finally(() => window.reader.quit()); if (!book) window.reader.quit(); },
    };
    handlers[id]?.();
  };
  useEffect(() => {
    const onKey = event => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      const chord = keyChord(event), action = ACTIONS.find(([id]) => settings.shortcuts[id] && settings.shortcuts[id] === chord)?.[0];
      if (!action) return;
      if (modal && !['exitFullscreen', 'resetShortcuts'].includes(action) && !(modal === 'editor' && action.startsWith('editor'))) return;
      if (!book && ['next','previous','nextPage','previousPage','first','last','goToPage','editPanels','redetect'].includes(action)) return;
      event.preventDefault(); if (event.repeat && !['scrollDown','scrollUp','scrollLeft','scrollRight','zoomIn','zoomOut'].includes(action)) return;
      run(action);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });
  const title = id => `${ACTIONS.find(([a]) => a === id)?.[1] ?? id}${settings.shortcuts[id] ? ` (${settings.shortcuts[id]})` : ''}`;
  const actionButton = (id, icon, label, extra = {}) => <Button icon={icon} title={title(id)} aria-label={ACTIONS.find(([a]) => a === id)?.[1]} onClick={() => run(id)} {...extra}>{label}</Button>;
  const showChrome = view === 'library' || chrome;
  const resume = data.books.find(b => b.id === data.lastBook) ?? data.books.filter(b => b.lastRead).sort((a, b) => b.lastRead - a.lastRead)[0];
  return <div className={`app ${fullscreen ? 'fullscreen' : ''} ${!showChrome ? 'immersive' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false); }} onDrop={async e => {
    e.preventDefault(); setDragging(false);
    try { const paths = [...e.dataTransfer.files].map(f => window.reader.pathForFile(f)).filter(Boolean); if (paths.length) { const values = await window.reader.addPaths(paths); openBook(values[0].id); } } catch (error) { notify(error.message, true); }
  }}>
    {view === 'library' ? <>
      <aside className="sidebar"><div className="brand"><div className="brand-mark"><i/><i/><i/></div><span>Panel<span className="brand-light">Reader</span></span></div>
        <div className="sidebar-label">COLLECTION</div><button className={`nav-item ${!newOnly ? 'active' : ''}`} onClick={() => setNewOnly(false)}><Icon name="library"/>All comics<span>{data.books.length}</span></button>
        <button className={`nav-item ${newOnly ? 'active' : ''}`} onClick={() => setNewOnly(true)}><Icon name="plus"/>Newly added<span>{data.books.filter(b => b.isNew).length}</span></button>
        <div className="sidebar-label folder-label">LIBRARY FOLDERS<button title={title('addFolder')} aria-label="Add library folder" onClick={() => scan(true)}>+</button></div>
        <div className="folder-list">{data.folders.map(folder => <div key={folder} title={folder}><Icon name="folder" size={17}/><span>{folder.split(/[\\/]/).filter(Boolean).at(-1)}</span></div>)}{!data.folders.length && <p>Add a folder to keep your<br/>collection in sync.</p>}</div>
        <button className="sidebar-scan" onClick={() => scan(false)} disabled={!!busy}><Icon name="refresh" size={16}/>{busy || 'Rescan folders'}</button>
        <div className="sidebar-bottom"><div className="local-badge"><span/>Local. Offline. Yours.</div>{actionButton('settings', 'settings', 'Preferences')}</div>
      </aside>
      <main className="library-main"><header className="library-top"><div className="breadcrumb">COLLECTION <span>/</span> {newOnly ? 'NEWLY ADDED' : 'ALL COMICS'}</div><div className="button-row">{actionButton('openImages', 'webtoon', 'Image folder')}{actionButton('openFile', 'open', 'Open comic')}{actionButton('addFolder', 'plus', 'Add folder', { className: 'primary' })}</div></header>
        <div className="library-content"><div className="library-title"><div><span className="eyebrow">A LITTLE SPACE FOR OTHER WORLDS</span><h1>Your library<span>.</span></h1><p>{data.books.length ? `${data.books.length} comics, ready when you are.` : 'All your stories. One quiet place to read.'}</p></div><div className="format-tags"><span>CBZ</span><span>CBR</span><span>WEBTOON</span></div></div>
          {resume && !search && !newOnly && <button className="resume-card" onClick={() => openBook(resume.id)}><div className="resume-cover"><img src={imageUrl(resume.id, 0, 'cover')} alt=""/></div><div><span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2>{resume.title}</h2><p>Page {(resume.progress?.page ?? 0) + 1}{resume.pageCount ? ` of ${resume.pageCount}` : ''} <span>·</span> {resume.format}</p><span className="resume-link">Continue reading <Icon name="arrow" size={17}/></span></div><div className="resume-art"><Icon name="book" size={110}/></div></button>}
          <div className="library-controls"><div className="collection-tabs"><button className={!newOnly ? 'active' : ''} onClick={() => setNewOnly(false)}>All comics <span>{data.books.length}</span></button><button className={newOnly ? 'active' : ''} onClick={() => setNewOnly(true)}>Newly added <span>{data.books.filter(b => b.isNew).length}</span></button></div><div className="button-row"><label className="search"><Icon name="search" size={17}/><input ref={searchInput} aria-label="Search comics" placeholder="Find a story…" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Sort comics" value={sort} onChange={e => setSort(e.target.value)}><option value="title">Title A–Z</option><option value="recent">Last read</option><option value="added">Recently added</option></select></div></div>
          {books.length ? <div className="book-grid">{books.map(b => <button className={`book-card ${b.missing ? 'missing' : ''}`} key={b.id} onClick={() => openBook(b.id)} title={b.path}><div className="cover"><img loading="lazy" src={imageUrl(b.id, 0, 'cover')} alt={`Cover of ${b.title}`} onError={e => { e.currentTarget.style.opacity = 0; }}/><div className="cover-fallback"><Icon name="book" size={44}/></div>{b.isNew && <span className="new-badge">NEW</span>}<span className="cover-play"><Icon name="open"/>Read comic</span>{b.progress && <div className="reading-progress" style={{ width: `${((b.progress.page + 1) / (b.pageCount || 1)) * 100}%` }}/>}</div><h3>{b.title}</h3><div className="book-meta"><span>{b.format}</span><span>{b.missing ? 'Unavailable' : b.progress ? `Page ${b.progress.page + 1} / ${b.pageCount}` : 'Unread'}</span></div></button>)}</div> : <div className="empty-library"><div className="empty-art"><div/><div/><Icon name="book" size={64}/></div><h2>{data.books.length ? 'No comics match this view.' : 'Your next story starts here.'}</h2><p>{data.books.length ? 'Try another search or view all comics.' : 'Add your comics folder, open an archive, or drop a CBZ or CBR here.'}</p>{!data.books.length && <div className="button-row">{actionButton('addFolder', 'folder', 'Choose a folder', { className: 'primary' })}{actionButton('openFile', 'open', 'Open a comic')}</div>}<div className="empty-features"><span><Icon name="panels" size={17}/>Guided panel reading</span><span><Icon name="webtoon" size={17}/>Continuous webtoons</span><span><Icon name="keyboard" size={17}/>Your own shortcuts</span></div></div>}
        </div><footer className="library-footer"><span>Made for the art. Built for the reader.</span><span>Panel Reader <b>0.1</b></span></footer>
      </main>
    </> : <main className="reader-main">
      {showChrome && <header className="reader-toolbar"><div className="reader-title">{actionButton('library', 'library')}<div><strong title={book?.title}>{book?.title}</strong><span>{book?.format} <i>·</i> {settings.mode === 'guided' ? 'Guided panels' : settings.mode === 'webtoon' ? 'Continuous scroll' : 'Page view'}</span></div></div><div className="reader-tools"><div className="segmented">{actionButton('fitPage','fit',null,{ className: (settings.mode === 'guided' ? settings.panelFit : settings.fit) === 'page' ? 'active' : '' })}{actionButton('fitWidth','width',null,{ className: (settings.mode === 'guided' ? settings.panelFit : settings.fit) === 'width' ? 'active' : '' })}{actionButton('fitHeight','height',null,{ className: (settings.mode === 'guided' ? settings.panelFit : settings.fit) === 'height' ? 'active' : '' })}</div><div className="tool-divider"/>{actionButton('guided','panels',null,{ className: settings.mode === 'guided' ? 'active' : '' })}{actionButton('webtoon','webtoon',null,{ className: settings.mode === 'webtoon' ? 'active' : '' })}{actionButton('editPanels','edit')}<div className="tool-divider"/>{actionButton('settings','settings')}{actionButton('fullscreen','fullscreen')}</div></header>}
      {book && <Reader key={book.id} ref={reader} book={{ ...book, progress: { page, offset: offset.current } }} page={page} info={info} panels={panels} panel={panel} settings={settings} zoom={zoom} onPage={setPage} onOffset={value => { offset.current = value; }} onError={message => notify(message, true)}/>}
      {showChrome && <footer className="reader-footer"><div className="reader-status">{detecting ? <><span className="spinner small"/>Finding panels…</> : settings.mode === 'guided' ? <><span className="status-dot"/>{panels?.manual ? 'Your panel layout' : panels?.fallback ? 'Whole page' : `${panels?.panels.length ?? '…'} panels detected`}</> : <span>{settings.direction === 'ltr' ? 'Left to right' : 'Right to left'} <i>·</i> {settings.mode === 'webtoon' ? 'Continuous scroll' : 'Drag to pan'}</span>}</div><div className="page-navigation">{actionButton('previous','previous',null,{ disabled: detecting && settings.mode === 'guided' })}{settings.showCounter && <button className="page-count" title={title('goToPage')} onClick={() => run('goToPage')}>Page <strong>{page + 1}</strong> / {book?.names.length}{settings.mode === 'guided' && panels && <span> · Panel {Number.isFinite(panel) ? panel + 1 : '…'} / {panels.panels.length}</span>}</button>}{actionButton('next','next',null,{ disabled: detecting && settings.mode === 'guided' })}</div><div className="zoom-tools">{actionButton('zoomOut','minus')}<span>{Math.round(zoom * 100)}%</span>{actionButton('zoomIn','plus')}</div></footer>}
    </main>}
    {(modal === 'settings' || modal === 'background') && <Preferences key={modal} settings={settings} update={update} folders={data.folders} onRemoveFolder={folder => window.reader.removeFolder(folder).catch(e => notify(e.message, true))} onClose={() => setModal(null)}/>}
    {modal === 'editor' && panels && <PanelEditor key={`${book.id}-${page}`} ref={editor} book={book} page={page} result={panels} onSave={async corrections => { const result = await window.reader.savePanels(book.id, page, corrections); setPanels(result); setPanel(0); setModal(null); notify('Panel layout saved.'); }} onClose={() => setModal(null)} onError={message => notify(message, true)}/>}
    {modal === 'editor' && !panels && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-label="Loading panel editor"><h2>{detecting ? 'Finding panels…' : 'Could not detect panels'}</h2><p>{detecting ? 'Preparing the editable page layout.' : 'You can draw the page layout yourself.'}</p><div className="button-row"><Button onClick={() => setModal(null)}>Cancel</Button>{!detecting && info && <Button onClick={() => setPanels({ ...info, panels: [{ x: 0, y: 0, w: 1, h: 1, polygon: [[0,0],[1,0],[1,1],[0,1]] }] })}>Draw manually</Button>}</div></section></div>}
    {modal === 'goto' && <div className="modal-backdrop"><form className="modal small-modal" role="dialog" aria-label="Go to page" onSubmit={e => { e.preventDefault(); const value = Number(goto); if (Number.isInteger(value) && value >= 1 && value <= book.names.length) { go(value - 1); setModal(null); } }}><h2>Go to page</h2><p>Choose a page from 1 to {book.names.length}.</p><input autoFocus aria-label="Page number" type="number" min={1} max={book.names.length} value={goto} onChange={e => setGoto(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setModal(null); }}/><footer><Button type="button" onClick={() => setModal(null)}>Cancel</Button><Button className="primary" type="submit">Go to page</Button></footer></form></div>}
    {modal === 'redetect' && <div className="modal-backdrop"><section className="modal small-modal" role="dialog" aria-label="Replace saved panels"><h2>Replace this page’s corrections?</h2><p>Detecting again replaces your saved outlines and reading order for this page.</p><footer><Button onClick={() => setModal(null)}>Keep corrections</Button><Button className="primary" onClick={() => { setModal(null); detect(true); }}>Detect again</Button></footer></section></div>}
    {toast && showChrome && <div role="status" className={`toast ${toast.error ? 'error' : ''}`}><Icon name={toast.error ? 'close' : 'check'} size={18}/><span>{toast.message}</span><button aria-label="Dismiss message" onClick={() => setToast(null)}>×</button></div>}
    {busy && view === 'reader' && showChrome && <div className="busy-label"><span className="spinner small"/>{busy}</div>}
    {dragging && <div className="drop-overlay"><Icon name="book" size={60}/><h2>Drop into your next story.</h2><p>CBZ · CBR · ZIP · RAR · Image folders</p></div>}
  </div>;
}
