import React, { useEffect, useRef, useState } from 'react';
import { ACTIONS, DEFAULT_SETTINGS, keyChord } from '../core/settings.mjs';
import { Button, Icon } from './icons.jsx';
export default function Preferences({ settings, update, folders, onRemoveFolder, onChangeFolder, onChooseSaveFolder, onChooseProgressFolder, onStopSharing, syncStatus, onClose, initialTab = 'reading' }) {
  const [tab, setTab] = useState(initialTab), [recording, setRecording] = useState(null), [message, setMessage] = useState(''), [filter, setFilter] = useState('');
  const dialog = useRef();
  useEffect(() => { dialog.current.focus(); }, []);
  const set = (name, value) => update({ ...settings, [name]: value });
  const capture = (event, id) => {
    event.preventDefault(); event.stopPropagation();
    const chord = keyChord(event); if (!chord) return;
    const collision = ACTIONS.find(([other]) => other !== id && settings.shortcuts[other] === chord);
    if (collision) { setMessage(`${chord} is assigned to “${collision[1]}”. Clear that binding first.`); return; }
    set('shortcuts', { ...settings.shortcuts, [id]: chord }); setRecording(null); setMessage('Shortcut saved.');
  };
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={dialog} tabIndex={-1} className="modal preferences" role="dialog" aria-modal="true" aria-label="Preferences" onKeyDown={e => {
    if (recording) { capture(e, recording); return; }
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') { const list = [...dialog.current.querySelectorAll('button:not(:disabled), input, select, [tabindex="0"]')]; if (e.shiftKey && document.activeElement === list[0]) { e.preventDefault(); list.at(-1)?.focus(); } else if (!e.shiftKey && document.activeElement === list.at(-1)) { e.preventDefault(); list[0]?.focus(); } }
  }}>
    <header><div><h2>Preferences</h2></div><Button icon="close" title="Close preferences" onClick={onClose}/></header>
    <nav className="tabs">{[['reading','Reading'],['panels','Guided panels'],['shortcuts','Shortcuts'],['library','Library']].map(([id, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className="preferences-body">
      {tab === 'reading' && <>
        <h3>Reading</h3><p className="muted">Changes save automatically and apply to the reader immediately.</p>
        <label className="setting-row"><span>Reading background<small>The space around the page.</small></span><div className="color-control"><code>{settings.background}</code><input aria-label="Reading background" type="color" value={settings.background} onChange={e => set('background', e.target.value)}/></div></label>
        <label className="setting-row"><span>Scroll distance<small>Pixels per Up / Down key press. These keys never turn a page.</small></span><div className="number-control"><input aria-label="Scroll distance" type="number" min="10" max="2000" value={settings.scrollAmount} onChange={e => set('scrollAmount', Number(e.target.value))}/><span>px</span></div></label>
        <Toggle label="Smooth scrolling" checked={settings.smoothScroll} onChange={v => set('smoothScroll', v)}/>
        <Toggle label="Show page counter" description="Hidden together with all controls in clean fullscreen." checked={settings.showCounter} onChange={v => set('showCounter', v)}/>
        <label className="setting-row"><span>Reading direction</span><select aria-label="Reading direction" value={settings.direction} onChange={e => set('direction', e.target.value)}><option value="ltr">Left to right</option><option value="rtl">Right to left</option></select></label>
        <h3>Webtoon & continuous scroll</h3>
        <label className="setting-row"><span>Column width<small>Fits smaller windows automatically.</small></span><div className="number-control"><input aria-label="Webtoon width" type="number" min="240" max="4000" value={settings.webtoonWidth} onChange={e => set('webtoonWidth', +e.target.value)}/><span>px</span></div></label>
        <label className="setting-row"><span>Gap between images</span><div className="number-control"><input aria-label="Webtoon gap" type="number" min="0" max="100" value={settings.webtoonGap} onChange={e => set('webtoonGap', +e.target.value)}/><span>px</span></div></label>
        <h3>Saved pages</h3>
        <div className="setting-row"><span>Destination folder<small>Original image files are grouped by comic. Save the current page with {settings.shortcuts.savePage || 'the reader button'}.</small><small className="saved-pages-path">{settings.savePageFolder || 'No folder selected'}</small></span><Button icon="folder" onClick={onChooseSaveFolder}>Choose saved pages folder</Button></div>
      </>}
      {tab === 'panels' && <>
        <div className="info-banner"><Icon name="panels"/><div><strong>Local panel detection</strong><p>Panels include their speech bubbles. Missed areas are recovered as local reading regions, and switching views remembers your selected panel. </p></div></div>
        <Toggle label="Refine panel boundaries" description="Use an additional model to check panel boundaries." checked={settings.shapeDetection} onChange={v => set('shapeDetection', v)}/>
        <Range label="Detection confidence" description="Lower finds more candidates. Higher reduces false panels." value={settings.detectionThreshold} min={.1} max={.9} step={.01} display={`${Math.round(settings.detectionThreshold * 100)}%`} onChange={v => set('detectionThreshold', v)}/>
        <Range label="Space around each panel" value={settings.panelPadding} min={0} max={20} step={1} display={`${settings.panelPadding}%`} onChange={v => set('panelPadding', v)}/>
        <Range label="Dim surrounding artwork" value={settings.panelDim} min={0} max={1} step={.05} display={`${Math.round(settings.panelDim * 100)}%`} onChange={v => set('panelDim', v)}/>
        <p className="muted">Unusual art, borderless panels, and advertisements can confuse detection. Use Edit panels to draw rectangles or polygons and correct their order. Corrections are saved for that page and used whenever you reopen it. They do not retrain the bundled models. “Detect again” replaces them.</p>
      </>}
      {tab === 'shortcuts' && <>
        <div className="shortcut-heading"><p>Click a binding, then press your key combination.<br/><span className="muted">Every reader command can be reassigned or unbound.</span></p><Button onClick={() => { set('shortcuts', { ...DEFAULT_SETTINGS.shortcuts }); setMessage('Defaults restored.'); }}>Reset defaults</Button></div>
        <input className="shortcut-search" aria-label="Find a command" placeholder="Find a command…" value={filter} onChange={e => setFilter(e.target.value)}/>
        <p role="status" className="binding-message">{message || (recording ? 'Press a key combination. Click the binding again to cancel.' : 'No duplicate bindings. Settings persist between launches.')}</p>
        <div className="shortcut-list">{ACTIONS.filter(([id, label]) => `${id} ${label}`.toLowerCase().includes(filter.toLowerCase())).map(([id, label]) => <div key={id}><span>{label}</span><button className={`binding ${recording === id ? 'recording' : ''}`} aria-label={`Shortcut for ${label}`} onClick={() => { setRecording(recording === id ? null : id); setMessage(''); }}>{recording === id ? 'Press keys…' : settings.shortcuts[id] || 'Unbound'}</button><button className="clear-binding" aria-label={`Clear shortcut for ${label}`} onClick={() => set('shortcuts', { ...settings.shortcuts, [id]: '' })}>×</button></div>)}</div>
      </>}
      {tab === 'library' && <>
        <h3>Library</h3>
        <div className="setting-row progress-setting"><span>Share reading progress<small>Choose the same network folder on each device. Comics can be local copies or on a shared drive; names and folders can differ.</small><small className="saved-pages-path">{settings.progressFolder || 'Saved on this device only'}</small>{settings.progressFolder && <small role="status" className={`sync-status ${syncStatus?.state ?? 'pending'}`}>{syncStatus?.message || 'Connecting to the shared folder…'}</small>}</span><div className="progress-folder-actions"><Button icon="folder" onClick={onChooseProgressFolder}>{settings.progressFolder ? 'Change shared folder' : 'Choose shared folder'}</Button>{settings.progressFolder && <button className="muted" onClick={onStopSharing}>Stop sharing</button>}</div></div>
        <label className="setting-row"><span>Automatic rescan<small>Minutes between scans. Set to 0 for manual rescans only.</small></span><input aria-label="Automatic rescan minutes" type="number" min="0" max="120" value={settings.autoScanMinutes} onChange={e => set('autoScanMinutes', +e.target.value)}/></label>
        <Toggle label="Continue between comics" description="Cross the first or last page to read the previous or next comic in this folder." checked={settings.autoNextComic} onChange={v => set('autoNextComic', v)}/>
        <h3>Watched folders</h3>{folders.length ? folders.map(folder => <div className="folder-setting" key={folder}><Icon name="folder"/><span>{folder}</span><Button onClick={() => onChangeFolder(folder)}>Change…</Button><Button onClick={() => onRemoveFolder(folder)}>Remove</Button></div>) : <p className="muted">Add a library folder to find comics, including subfolders.</p>}
        <p className="muted">Changing a folder is useful after moving the same collection and preserves matching reading history. Removing it clears its comics from this library. Original files are never modified.</p>
      </>}
    </div><footer><span className="muted"><Icon name="check" size={14}/> Saved on this computer</span><Button className="primary" onClick={onClose}>Done</Button></footer>
  </section></div>;
}
function Toggle({ label, description, checked, onChange }) { return <label className="setting-row"><span>{label}{description && <small>{description}</small>}</span><input className="switch" type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}/></label>; }
function Range({ label, description, value, min, max, step, display, onChange }) { return <label className="setting-row"><span>{label}{description && <small>{description}</small>}</span><div className="range-control"><input aria-label={label} type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(+e.target.value)}/><span>{display}</span></div></label>; }
