import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
const imageUrl = (id, page, suffix = 'image') => `comic://book/${id}/${page}/${suffix}`;
export { imageUrl };
export const Reader = forwardRef(function Reader({ book, page, info, panels, panel, settings, zoom, onPage, onOffset, onError }, forwarded) {
  const viewport = useRef(), drag = useRef(), [size, setSize] = useState({ width: 1000, height: 700 });
  const guided = settings.mode === 'guided', webtoon = settings.mode === 'webtoon';
  const active = panels?.panels[Math.min(panel, panels.panels.length - 1)];
  const restoreOffset = useRef(book.progress?.offset ?? 0);
  const layoutKey = useRef('');
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
    goToPage(target) {
      if (webtoon) {
        webTarget.current = { page: target, offset: 0 };
        webPosition.current = webTarget.current;
        const element = viewport.current?.querySelector(`[data-page="${target}"]`);
        if (element) viewport.current.scrollTop = element.offsetTop;
        if (webInfo[target]) webTarget.current = null;
      }
    },
  }), [settings.smoothScroll, webtoon, webInfo]);
  const width = info?.width ?? 1, height = info?.height ?? 1;
  const availableW = Math.max(1, size.width - 32), availableH = Math.max(1, size.height - 32);
  let scale = settings.fit === 'width' ? availableW / width : settings.fit === 'height' ? availableH / height : settings.fit === 'actual' ? 1 : Math.min(availableW / width, availableH / height);
  if (guided && active) {
    const padding = settings.panelPadding / 100;
    const fitW = availableW / (width * Math.min(1, active.w + padding * 2)), fitH = availableH / (height * Math.min(1, active.h + padding * 2));
    scale = settings.panelFit === 'width' ? fitW : settings.panelFit === 'height' ? fitH : settings.panelFit === 'actual' ? 1 : Math.min(fitW, fitH);
  }
  scale = Math.max(.01, Math.min(12, scale * zoom));
  const drawnW = width * scale, drawnH = height * scale, surfaceW = Math.max(size.width, drawnW + 32), surfaceH = Math.max(size.height, drawnH + 32);
  const left = (surfaceW - drawnW) / 2, top = (surfaceH - drawnH) / 2;
  useLayoutEffect(() => {
    if (webtoon || !info || !viewport.current) return;
    const element = viewport.current;
    const key = `${book.id}:${page}:${settings.fit}:${guided}:${zoom}`;
    if (!guided && layoutKey.current === key) return;
    layoutKey.current = key;
    if (guided && active) element.scrollTo({ left: left + (active.x + active.w / 2) * drawnW - size.width / 2, top: top + (active.y + active.h / 2) * drawnH - size.height / 2, behavior: 'instant' });
    else element.scrollTo({ left: (surfaceW - size.width) / 2, top: restoreOffset.current * Math.max(0, surfaceH - size.height), behavior: 'instant' });
    restoreOffset.current = 0;
  }, [book.id, page, panel, info, guided, webtoon, scale, size.width, size.height]);
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
  }, [webtoon, book.id, webInfo, size.width, settings.webtoonWidth, zoom]);
  const onScroll = () => {
    const element = viewport.current;
    if (webtoon) {
      if (webTarget.current) return;
      const position = currentWebPosition();
      webPosition.current = position;
      onPage(position.page); onOffset(position.offset);
    } else onOffset(element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight));
  };
  return <div ref={viewport} className={`reading-viewport ${guided ? 'guided' : ''} ${webtoon ? 'webtoon' : ''}`} style={{ background: settings.background }} onScroll={onScroll}
    onPointerDown={event => { if (event.button !== 0 || webtoon) return; drag.current = { x: event.clientX, y: event.clientY, left: viewport.current.scrollLeft, top: viewport.current.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) { viewport.current.scrollLeft = drag.current.left - event.clientX + drag.current.x; viewport.current.scrollTop = drag.current.top - event.clientY + drag.current.y; } }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    {webtoon ? <div className="webtoon-stack" style={{ width: Math.min(size.width, settings.webtoonWidth * zoom), gap: settings.webtoonGap }}>
      {book.names.map((name, index) => <WebtoonPage key={`${book.id}-${index}`} id={book.id} page={index} name={name} root={viewport} width={Math.min(size.width, settings.webtoonWidth * zoom)} onInfo={value => receiveWebInfo(index, value)} onError={onError}/>)}
    </div> : info ? <div className="page-surface" style={{ width: surfaceW, height: surfaceH }}>
      <div className="page-art" style={{ width: drawnW, height: drawnH, left, top }}>
        {Array.from({ length: info.tiles }, (_, i) => <img key={`${book.id}-${page}-${i}`} src={imageUrl(book.id, page, info.tiles > 1 ? `tile/${i}` : 'image')} alt={`${book.title}, page ${page + 1}${info.tiles > 1 ? `, strip ${i + 1}` : ''}`} draggable="false" style={{ width: drawnW, height: Math.min(info.tileHeight, height - i * info.tileHeight) * scale }} onError={() => onError('Could not decode this page. Try reopening the comic.')} />)}
        {guided && active && <svg className="panel-shade" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"><path d={`M0 0H1V1H0Z M${active.polygon.map(p => p.join(' ')).join('L')}Z`} fill="black" fillOpacity={settings.panelDim} fillRule="evenodd"/></svg>}
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
