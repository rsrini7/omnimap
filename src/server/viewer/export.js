import { esc } from './helpers.js';

// ── export diagram ──────────────────────────────────────
function showExportToast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#222;color:#ccc;padding:10px 20px;border-radius:6px;font-size:13px;font-family:var(--font);z-index:99999;border:1px solid #444;';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function resolveDataKeyExact(cls, classesData) {
  if (classesData[cls]?.diagram) return cls;
  return null;
}

function addTitleToSvg(svg, cls) {
  const project = (typeof window.__projectName === 'string' && window.__projectName) || 'omm';
  const shortName = cls.includes('/') ? cls.split('/').pop() : cls;
  const title = `${esc(project)} — ${esc(shortName)}`;

  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  let vx = 0, vy = 0, vw = 800, vh = 600;
  if (vbMatch) {
    const p = vbMatch[1].split(/\s+/);
    if (p.length === 4) { vx = +p[0]; vy = +p[1]; vw = +p[2]; vh = +p[3]; }
  }

  const headerH = 44;
  const newVb = `${vx} ${vy} ${vw} ${vh + headerH}`;
  const titleBlock = `\n    <rect x="${vx}" y="${vy}" width="${vw}" height="${headerH}" fill="#111"/>\n    <text x="${vx + 16}" y="${vy + 28}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="600" fill="#ccc">${title}</text>\n    <line x1="${vx}" y1="${vy + headerH}" x2="${vx + vw}" y2="${vy + headerH}" stroke="#333" stroke-width="1"/>\n  `;

  let out = svg.replace(/viewBox="[^"]*"/, `viewBox="${newVb}"`);
  const svgOpenEnd = out.indexOf('>') + 1;
  const svgClose = out.lastIndexOf('</svg>');
  if (svgClose >= 0) {
    out = out.slice(0, svgOpenEnd) + titleBlock + `<g transform="translate(0,${headerH})">`
      + out.slice(svgOpenEnd, svgClose) + '</g>' + out.slice(svgClose);
  } else {
    out = out.slice(0, svgOpenEnd) + titleBlock + `<g transform="translate(0,${headerH})">` + out.slice(svgOpenEnd) + '</g>';
  }
  return out;
}

function downloadSvg(svgString, filename) {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportElementSvg(cls, classesData, renderFlatSVG) {
  const dataKey = resolveDataKeyExact(cls, classesData);
  const data = dataKey ? classesData[dataKey] : null;
  if (!data?.diagram) { showExportToast('No diagram for this element'); return; }
  let svg = renderFlatSVG(data.diagram);
  if (!svg) { showExportToast('Could not render diagram'); return; }
  svg = addTitleToSvg(svg, cls);
  const full = `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`;
  downloadSvg(full, `${cls.replace(/\//g, '_')}.svg`);
}

function exportElementPng(cls, classesData, renderFlatSVG) {
  const dataKey = resolveDataKeyExact(cls, classesData);
  const data = dataKey ? classesData[dataKey] : null;
  if (!data?.diagram) { showExportToast('No diagram for this element'); return; }
  let svg = renderFlatSVG(data.diagram);
  if (!svg) { showExportToast('Could not render diagram'); return; }
  svg = addTitleToSvg(svg, cls);

  const vbMatch = svg.match(/viewBox="([^"]+)"/);
  let svgW = 800, svgH = 600;
  if (vbMatch) {
    const parts = vbMatch[1].split(/\s+/);
    if (parts.length === 4) { svgW = parseFloat(parts[2]) || 800; svgH = parseFloat(parts[3]) || 600; }
  }

  let sizedSvg = svg;
  if (!/width="\d/.test(svg)) {
    sizedSvg = sizedSvg.replace(/<svg/, `<svg width="${svgW}" height="${svgH}"`);
  }

  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = svgW * scale;
  canvas.height = svgH * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#000';
  ctx.fillRect(0, 0, svgW, svgH);

  const img = new Image();
  const blob = new Blob([sizedSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  img.onload = () => {
    ctx.drawImage(img, 0, 0, svgW, svgH);
    canvas.toBlob((pngBlob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pngBlob);
      a.download = `${cls.replace(/\//g, '_')}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    downloadSvg(sizedSvg, `${cls.replace(/\//g, '_')}.svg`);
  };
  img.src = url;
}

/** Setup export button — call after DOM is ready */
export function setupExport(getSelectedCls, classesDataRef, renderFlatSVGRef) {
  window.exportDiagram = function() {
    const cls = getSelectedCls();
    if (!cls) {
      const svgEl = document.querySelector('#canvas svg');
      if (svgEl) downloadSvg(new XMLSerializer().serializeToString(svgEl), 'diagram.svg');
      return;
    }
    const existing = document.getElementById('export-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.id = 'export-menu';
    const btn = document.getElementById('export-btn');
    const rect = btn.getBoundingClientRect();
    menu.style.cssText = `position:fixed;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;background:#111;border:1px solid #333;border-radius:6px;padding:4px 0;z-index:9999;min-width:120px;`;
    const items = [
      { label: 'SVG', action: () => exportElementSvg(cls, classesDataRef(), renderFlatSVGRef) },
      { label: 'PNG', action: () => exportElementPng(cls, classesDataRef(), renderFlatSVGRef) },
    ];
    for (const {label, action} of items) {
      const item = document.createElement('button');
      item.textContent = label;
      item.style.cssText = 'display:block;width:100%;padding:6px 14px;background:none;border:none;color:#ccc;font-size:12px;cursor:pointer;text-align:left;font-family:var(--mono);';
      item.onmouseover = () => item.style.background = '#1a1a1a';
      item.onmouseout = () => item.style.background = 'none';
      item.onclick = (e) => { e.stopPropagation(); menu.remove(); action(); };
      menu.appendChild(item);
    }
    document.body.appendChild(menu);

    function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== btn) {
        menu.remove();
        document.removeEventListener('mousedown', closeMenu);
      }
    }
    setTimeout(() => document.addEventListener('mousedown', closeMenu), 0);
  };
}
