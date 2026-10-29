import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Icon, Button } from './icons.jsx';
import { imageUrl } from './Reader.jsx';
export const PanelEditor = forwardRef(function PanelEditor({ book, page, result, onSave, onClose, onError }, forwarded) {
  const [panels, setPanels] = useState(result.panels), [selected, setSelected] = useState(0), [tool, setTool] = useState('select'), [points, setPoints] = useState([]), [draft, setDraft] = useState(null), [saving, setSaving] = useState(false);
  const svg = useRef(), origin = useRef();
  const preview = useRef(), [previewSize, setPreviewSize] = useState({ width: 600, height: 600 });
  useEffect(() => { const observer = new ResizeObserver(([entry]) => setPreviewSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(preview.current); return () => observer.disconnect(); }, []);
  const canvasWidth = Math.min(previewSize.width, previewSize.height * result.width / result.height);
  const point = event => { const rect = svg.current.getBoundingClientRect(); return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]; };
  const add = polygon => { if (polygon.length < 3) return; const xs = polygon.map(p => p[0]), ys = polygon.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y; if (w < .005 || h < .005) return; setPanels(old => [...old, { x, y, w, h, polygon, confidence: 1, source: 'manual' }]); setSelected(panels.length); setTool('select'); setPoints([]); };
  const move = delta => { const target = selected + delta; if (target < 0 || target >= panels.length) return; setPanels(old => { const next = [...old]; const [item] = next.splice(selected, 1); next.splice(target, 0, item); return next; }); setSelected(target); };
  const remove = () => { setPanels(old => old.filter((_, i) => i !== selected)); setSelected(Math.max(0, selected - 1)); };
  const save = async () => { setSaving(true); try { await onSave(panels); } catch (e) { onError(e.message); setSaving(false); } };
  useImperativeHandle(forwarded, () => ({ action(id) { if (id === 'editorAdd') setTool('rectangle'); if (id === 'editorPolygon') setTool('polygon'); if (id === 'editorSelect') setTool('select'); if (id === 'editorDelete') remove(); if (id === 'editorEarlier') move(-1); if (id === 'editorLater') move(1); if (id === 'editorSave') save(); if (id === 'editorFinish' && tool === 'polygon') add(points); } }));
  return <div className="modal-backdrop"><section className="editor modal" role="dialog" aria-modal="true" aria-label="Edit panels">
    <header><div><span className="eyebrow">GUIDED READING</span><h2>Edit panels</h2><p>Page {page + 1} · Draw an outline, then arrange the reading order.</p></div><Button icon="close" title="Close panel editor" onClick={onClose}/></header>
    <div className="editor-body"><div className="editor-preview" ref={preview}><div className="editor-canvas" style={{ width: canvasWidth, height: canvasWidth * result.height / result.width, maxWidth: '100%', flex: 'none' }}>
      <img src={imageUrl(book.id, page)} alt={`Page ${page + 1}`} draggable="false"/>
      <svg ref={svg} viewBox="0 0 1 1" preserveAspectRatio="none" className={`drawing tool-${tool}`}
        onPointerDown={e => { if (tool === 'rectangle') { origin.current = point(e); setDraft([origin.current, origin.current]); e.currentTarget.setPointerCapture(e.pointerId); } if (tool === 'polygon') setPoints(old => [...old, point(e)]); }}
        onPointerMove={e => { if (origin.current) setDraft([origin.current, point(e)]); }}
        onPointerUp={e => { if (origin.current) { const a = origin.current, b = point(e); origin.current = null; setDraft(null); add([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]]); } }}>
        {panels.map((p, i) => <g key={i} onPointerDown={e => { if (tool === 'select') { e.stopPropagation(); setSelected(i); } }}><polygon points={p.polygon.map(p => p.join(',')).join(' ')} fill={i === selected ? '#9ceac433' : '#15181b33'} stroke={i === selected ? '#a6f4d0' : '#ffffff'} strokeWidth=".004"/>{p.protectedRegions?.map((r, n) => <rect key={n} x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#f4bc76" strokeWidth=".002"/>)}<rect x={p.x} y={p.y} width=".046" height=".034" fill={i === selected ? '#a6f4d0' : 'white'}/><text x={p.x + .01} y={p.y + .025} fontSize=".026" fill="#111">{i + 1}</text></g>)}
        {points.length > 0 && <polyline points={points.map(p => p.join(',')).join(' ')} fill="none" stroke="#f4bc76" strokeWidth=".004"/>}
        {draft && <rect x={Math.min(draft[0][0], draft[1][0])} y={Math.min(draft[0][1], draft[1][1])} width={Math.abs(draft[0][0] - draft[1][0])} height={Math.abs(draft[0][1] - draft[1][1])} fill="#9ceac433" stroke="#a6f4d0" strokeWidth=".004"/>}
      </svg>
    </div></div><aside className="editor-tools"><div className="segmented vertical">
      <button className={tool === 'select' ? 'active' : ''} onClick={() => setTool('select')}>Select outline</button>
      <button className={tool === 'rectangle' ? 'active' : ''} onClick={() => setTool('rectangle')}>Draw rectangle</button>
      <button className={tool === 'polygon' ? 'active' : ''} onClick={() => { setTool('polygon'); setPoints([]); }}>Draw polygon</button>
    </div>{tool === 'polygon' && <><p>Click each corner. Finish to close the outline.</p><Button onClick={() => add(points)} disabled={points.length < 3}>Finish polygon</Button></>}
      <h3>Reading order</h3><div className="panel-list">{panels.map((p, i) => <button key={i} className={selected === i ? 'selected' : ''} onClick={() => setSelected(i)}><span>{String(i + 1).padStart(2, '0')}</span>Panel {i + 1}<Icon name="panels" size={16}/></button>)}</div>
      <div className="button-row"><Button onClick={() => move(-1)} disabled={selected === 0}>Earlier</Button><Button onClick={() => move(1)} disabled={selected >= panels.length - 1}>Later</Button></div>
      <Button icon="trash" onClick={remove} disabled={!panels.length}>Remove selected</Button>
      <p className="muted">Corrections are saved for this comic and page. Detection runs again only when you ask.</p>
    </aside></div>
    <footer><Button onClick={onClose}>Cancel</Button><Button icon="check" className="primary" disabled={saving || !panels.length} onClick={save}>{saving ? 'Saving…' : 'Save panels'}</Button></footer>
  </section></div>;
});
