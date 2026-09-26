import React from 'react';
const paths = {
  library: 'M3 3h7v18H3zM14 3h7v8h-7zM14 15h7v6h-7z',
  folder: 'M3 7V5h6l2 2h10v13H3z', open: 'M14 3h7v7M21 3l-9 9M10 5H4v15h15v-6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  next: 'M9 5l7 7-7 7', previous: 'M15 5l-7 7 7 7', close: 'M5 5l14 14M19 5L5 19',
  fullscreen: 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5',
  width: 'M3 4v16M21 4v16M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
  height: 'M4 3h16M4 21h16M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4',
  fit: 'M4 8V4h4M16 4h4v4M4 16v4h4M20 16v4h-4M8 8h8v8H8z',
  panels: 'M3 3h18v18H3zM3 11h18M13 3v8M10 11v10',
  webtoon: 'M6 2h12v8H6zM6 14h12v8H6z', search: 'M16 16l5 5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 4v16M4 12h16', minus: 'M4 12h16', edit: 'M4 16L16 4l4 4L8 20H4zM13 7l4 4',
  check: 'M4 12l5 5L20 6', arrow: 'M4 12h16M14 6l6 6-6 6', book: 'M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3zM12 6v15',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  keyboard: 'M2 6h20v13H2zM6 10h1M11 10h1M16 10h1M6 14h1M10 15h7',
  polygon: 'M6 3l13 4 2 11-12 3-7-9z', trash: 'M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7',
};
export function Icon({ name, size = 20 }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] || paths.book}/></svg>; }
export function Button({ icon, children, className = '', ...props }) { return <button className={`button ${children ? '' : 'icon-button'} ${className}`} {...props}>{icon && <Icon name={icon}/>} {children}</button>; }
