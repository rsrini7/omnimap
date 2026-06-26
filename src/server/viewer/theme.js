// ── theme ─────────────────────────────────────────────────
let _isDark = true;
export function isDark() { return _isDark; }
export function setIsDark(v) { _isDark = v; }

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

export function applyTheme() {
  document.body.classList.toggle('light', !_isDark);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = _isDark ? '○' : '●';
}

export function toggleTheme() {
  _isDark = !_isDark;
  safeStorageSet('omm-theme', _isDark ? 'dark' : 'light');
  applyTheme();
}

export function initTheme() {
  _isDark = safeStorageGet('omm-theme') !== 'light';
  applyTheme();
}

export function themeColors() {
  return _isDark ? {
    groupFill:'#0a0a0a', groupStroke:'#666666',
    subFill:'#111111', subStroke:'#666666', subLabelFill:'#ffffff',
    edgeColor0:'#909090', edgeColor1:'#787878',
    edgeLabelBg:'#000000', edgeLabelText:'#aaaaaa',
    grpLabelFill:'#ffffff', grpLabelCenterFill:'#dddddd',
  } : {
    groupFill:'#f8f8f8', groupStroke:'#bbb',
    subFill:'#efefef', subStroke:'#bbb', subLabelFill:'#888',
    edgeColor0:'#94a3b8', edgeColor1:'#bbb',
    edgeLabelBg:'#e8e8e8', edgeLabelText:'#475569',
    grpLabelFill:'#475569', grpLabelCenterFill:'#222',
  };
}
