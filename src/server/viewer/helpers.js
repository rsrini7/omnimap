// ── helpers ──────────────────────────────────────────────
const _tm = document.createElement('canvas').getContext('2d');
export function tw(t, f) { _tm.font = f || '11px Inter,system-ui'; return Math.ceil(_tm.measureText(t).width); }
export function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function r1(n) { return +n.toFixed(1); }
export function fmtLabel(s) { return s.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '); }
