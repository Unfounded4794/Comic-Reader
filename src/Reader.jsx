import React, { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
const imageUrl = (id, page, suffix = 'image') => `comic://book/${id}/${page}/${suffix}`;
export { imageUrl };
export const Reader = forwardRef(function Reader({ book, page, info, panels, panel, settings, zoom, onPage, onOffset, onError }, forwarded) {
  const maskId = useId();
  const viewport = useRef(), drag = useRef(), [size, setSize] = useState({ width: 1000, height: 700 });
  const guided = settings.mode === 'guided', webtoon = settings.mode === 'webtoon';
  const active = panels?.panels[Math.min(panel, panels.panels.length - 1)];
  const restoreOffset = useRef(book.progress?.offset ?? 0);
  const layoutKey = useRef('');
  const pageAnchor = useRef(null), previousLayout = useRef(null);
  const layoutScroll = useRef(null);
  const previousGuided = useRef(false);
  const [webInfo, setWebInfo] = useState({});
  const webPosition = useRef({ page, offset: book.progress?.offset ?? 0 }), webTarget = useRef(null), webAnchor = useRef(null);
  function currentWebPosition() {
    const element = viewport.current;
    const pages = [...element.querySelectorAll('[data-page]')];
    const current = pages.find(el => el.offsetTop + el.offsetHeight > element.scrollTop + 1) ?? pages.at(-1);
    return current ? { page: +current.dataset.page, offset: Math.max(0, (element.scrollTop - current.offsetTop) / current.offsetHeight) } : webPosition.current;
  }
  function receiveWebInfo(index, value) {
    // Capture an anchor before React changes any placeholder heights. Preserve
    // this image and its fractional offset as preceding images acquire dimensions.
    webAnchor.current ??= webTarget.current ?? currentWebPosition();
    setWebInfo(old => ({ ...old, [index]: value }));
  }
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport.current); return () => observer.disconnect();
  }, []);
  useImperativeHandle(forwarded, () => ({
    scroll(dx, dy) { viewport.current?.scrollBy({ left: dx, top: dy, behavior: settings.smoothScroll ? 'smooth' : 'instant' }); },
    position() { return webtoon ? currentWebPosition() : { page, offset: 0 }; },
    goToPage(target) {
      if (webtoon) {
        webTarget.current = { page: target, offset: 0 };
        webPosition.current = webTarget.current;
        const element = viewport.current?.querySelector(`[data-page="${target}"]`);
        if (element) viewport.current.scrollTop = element.offsetTop;
        if (webInfo[target]) webTarget.current = null;
      }
    },
  }), [settings.smoothScroll, webtoon, webInfo, page]);
  const width = info?.width ?? 1, height = info?.height ?? 1;
  const availableW = Math.max(1, size.width - 32), availableH = Math.max(1, size.height - 32);
  let scale = settings.fit === 'width' ? availableW / width : settings.fit === 'height' ? availableH / height : settings.fit === 'actual' ? 1 : Math.min(availableW / width, availableH / height);
  if (guided && active) {
    const padding = settings.panelPadding / 100;
    const fitW = availableW / (width * Math.min(1, active.w + padding * 2)), fitH = availableH / (height * Math.min(1, active.h + padding * 2));
    // Guided reading always contains the complete active frame. Page-view
    // width/height preferences must never crop a differently shaped panel.
    scale = Math.min(fitW, fitH);
  }
  scale = Math.max(.01, Math.min(12, scale * zoom));
  const drawnW = width * scale, drawnH = height * scale, surfaceW = Math.max(size.width, drawnW + 32), surfaceH = Math.max(size.height, drawnH + 32);
  const left = (surfaceW - drawnW) / 2, top = (surfaceH - drawnH) / 2;
  useLayoutEffect(() => {
    if (webtoon || !info || !viewport.current) return;
    if (guided && !active) return;
    const element = viewport.current;
    const key = `${book.id}:${page}:${settings.fit}:${guided}:${zoom}`;
    if (!guided && layoutKey.current === key) return;
    layoutKey.current = key;
    const leavingGuided = previousGuided.current && !guided;
    previousGuided.current = guided;
    const samePage = previousLayout.current === `${book.id}:${page}`;
    const anchor = guided ? { x: active.x + active.w / 2, y: active.y + active.h / 2 } : !leavingGuided && samePage ? pageAnchor.current : null;
    if (anchor) element.scrollTo({ left: left + anchor.x * drawnW - size.width / 2, top: top + anchor.y * drawnH - size.height / 2, behavior: 'instant' });
    else element.scrollTo({ left: (surfaceW - size.width) / 2, top: leavingGuided ? 0 : restoreOffset.current * Math.max(0, surfaceH - size.height), behavior: 'instant' });
    // A fit-height view clamps scrolling to zero. Its generated scroll event
    // must not replace the remembered panel centre with the page centre.
    pageAnchor.current = anchor;
    layoutScroll.current = { left: element.scrollLeft, top: element.scrollTop };
    previousLayout.current = `${book.id}:${page}`;
    restoreOffset.current = 0;
  }, [book.id, page, panel, info, panels, guided, webtoon, scale, size.width, size.height]);
  useLayoutEffect(() => {
    if (!webtoon) return;
    webTarget.current = { page, offset: book.progress?.offset ?? 0 };
    webPosition.current = webTarget.current;
    const target = viewport.current.querySelector(`[data-page="${page}"]`);
    if (target) viewport.current.scrollTop = target.offsetTop + webTarget.current.offset * target.offsetHeight;
  }, [webtoon, book.id]);
  useLayoutEffect(() => {
    if (!webtoon) return;
    const element = viewport.current;
    const position = webTarget.current ?? webAnchor.current ?? webPosition.current;
    const target = element.querySelector(`[data-page="${position.page}"]`);
    if (target) element.scrollTop = target.offsetTop + position.offset * target.offsetHeight;
    webPosition.current = position;
    webAnchor.current = null;
    if (webInfo[position.page]) webTarget.current = null;
  }, [webtoon, book.id, webInfo, size.width, settings.webtoonWidth, settings.fit, zoom]);
  const onScroll = () => {
    const element = viewport.current;
    if (webtoon) {
      if (webTarget.current) return;
      const position = currentWebPosition();
      webPosition.current = position;
      onPage(position.page); onOffset(position.offset);
    } else {
      onOffset(element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight));
      const generated = layoutScroll.current && Math.abs(element.scrollLeft - layoutScroll.current.left) < 1 && Math.abs(element.scrollTop - layoutScroll.current.top) < 1;
      if (!guided && !generated) pageAnchor.current = { x: (element.scrollLeft + size.width / 2 - left) / drawnW, y: (element.scrollTop + size.height / 2 - top) / drawnH };
    }
  };
  const webtoonBaseWidth = settings.fit === 'width' ? availableW : Math.min(availableW, settings.webtoonWidth);
  const webtoonDrawWidth = Math.max(120, webtoonBaseWidth * zoom);
  return <div ref={viewport} className={`reading-viewport ${guided ? 'guided' : ''} ${webtoon ? 'webtoon' : ''}`} style={{ background: settings.background }} onScroll={onScroll}
    onPointerDown={event => { if (event.button !== 0 || webtoon) return; drag.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) { viewport.current.scrollLeft = drag.current.left - event.clientX + drag.current.x; viewport.current.scrollTop = drag.current.top - event.clientY + drag.current.y; } }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    {webtoon ? <div className="webtoon-stack" style={{ width: webtoonDrawWidth, gap: settings.webtoonGap }}>
      {book.names.map((name, index) => <WebtoonPage key={`${book.id}-${index}`} id={book.id} page={index} name={name} root={viewport} width={webtoonDrawWidth} onInfo={value => receiveWebInfo(index, value)} onError={onError}/>)}
    </div> : info ? <div className="page-surface" style={{ width: surfaceW, height: surfaceH }}>
      <div className="page-art" style={{ width: drawnW, height: drawnH, left, top }}>
        {Array.from({ length: info.tiles }, (_, i) => <img key={`${book.id}-${page}-${i}`} src={imageUrl(book.id, page, info.tiles > 1 ? `tile/${i}` : 'image')} alt={`${book.title}, page ${page + 1}${info.tiles > 1 ? `, strip ${i + 1}` : ''}`} draggable="false" style={{ width: drawnW, height: Math.min(info.tileHeight, height - i * info.tileHeight) * scale }} onError={() => onError('Could not decode this page. Try reopening the comic.')} />)}
        {guided && active && <svg className="panel-shade" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><defs><mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1"><rect width="1" height="1" fill="white"/><polygon points={active.polygon.map(p => p.join(',')).join(' ')} fill="black"/>{active.protectedRegions?.map((r, i) => <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} fill="black"/>)}</mask></defs><rect width="1" height="1" fill="black" fillOpacity={settings.panelDim} mask={`url(#${maskId})`}/></svg>}
      </div>
    </div> : <div className="loading-page"><span className="spinner"/>Loading page…</div>}
  </div>;
});
function WebtoonPage({ id, page, name, root, width, onInfo, onError }) {
  const ref = useRef(), [visible, setVisible] = useState(false), [info, setInfo] = useState(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: root.current, rootMargin: '1600px' });
    observer.observe(ref.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || info) return;
    let canceled = false;
    window.reader.info(id, page).then(value => { if (!canceled) { setInfo(value); onInfo(value); } }).catch(e => { if (!canceled) onError(e.message); });
    return () => { canceled = true; };
  }, [visible, info, id, page]);
  return <div ref={ref} data-page={page} className="webtoon-page" style={{ width, height: width * (info ? info.height / info.width : 1.5) }}>
    {visible && info && Array.from({ length: info.tiles }, (_, tile) => <img key={tile} src={imageUrl(id, page, info.tiles > 1 ? `tile/${tile}` : 'image')} loading="lazy" alt={`Page ${page + 1}: ${name}`} draggable="false" style={{ width: '100%', height: width / info.width * Math.min(info.tileHeight, info.height - tile * info.tileHeight) }} onError={() => onError(`Could not load webtoon page ${page + 1}.`)}/>)}
  </div>;
}
