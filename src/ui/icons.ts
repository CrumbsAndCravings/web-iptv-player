// Icons as inline SVG, drawn in currentColor so CSS colours them.

function svg(body: string, size = 24): string {
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + "</svg>";
}

function solid(body: string, size = 24): string {
  return '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '" aria-hidden="true" fill="currentColor">' + body + "</svg>";
}

export const ICONS = {
  home: svg('<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v11h13V9"/><path d="M10 20v-5.5h4V20"/>'),
  movies: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  series: svg('<rect x="2.5" y="6" width="19" height="13" rx="2"/><path d="m8 2.5 4 3.5 4-3.5"/>'),
  categories: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/>'),
  account: solid('<circle cx="12" cy="8.5" r="4.2"/><path d="M3.8 20.5c1.2-4.1 4.4-6.2 8.2-6.2s7 2.1 8.2 6.2"/>'),
  back: svg('<path d="M15 4.5 7.5 12l7.5 7.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: solid('<path d="M7 4.5v15l12.5-7.5z"/>'),
  pause: solid('<rect x="5.5" y="4" width="4.5" height="16" rx="1.2"/><rect x="14" y="4" width="4.5" height="16" rx="1.2"/>'),
  back10: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><text x="12" y="15.6" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">10</text>'),
  forward10: svg('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v4.5h-4.5"/><text x="12" y="15.6" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="sans-serif">10</text>'),
  subtitles: svg('<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M6.5 12.5h3M12 12.5h5.5M6.5 15.5h7M15.5 15.5h2"/>'),
  episodes: svg('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>'),
  next: solid('<path d="M5 5v14l10-7zM16.5 5h2.5v14h-2.5z"/>'),
  restart: svg('<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/>'),
  airplay: svg('<path d="M6 17H4.5A1.5 1.5 0 0 1 3 15.5v-10A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v10a1.5 1.5 0 0 1-1.5 1.5H18"/><path d="m12 15 5 6H7z" fill="currentColor"/>'),
  pip: svg('<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor"/>'),
  fullscreen: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  more: solid('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chevron: svg('<path d="m9 5 7 7-7 7"/>', 18),
};
