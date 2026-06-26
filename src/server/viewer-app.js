import { tw, esc, r1, fmtLabel } from './viewer/helpers.js';
import { parseFlowchart, nodeStyle, smoothPath } from './viewer/parser.js';
import { isDark, setIsDark, initTheme, toggleTheme, applyTheme, themeColors } from './viewer/theme.js';
import { setupExport } from './viewer/export.js';

// theme() shim — returns themeColors() for backward compat
function theme() { return themeColors(); }

// ── render one class group (recursive) ────────────────────
// _expandedGlobal prevents same class from expanding in multiple branches
let _expandedGlobal = new Set();

function renderGroup(cls, classesData, allClasses, level, seen = new Set(), scopedPath) {
  if (seen.has(cls)) return null;
  seen = new Set(seen); seen.add(cls);
  if (!scopedPath) scopedPath = cls; // level 0: scopedPath = perspective name
  let labelOverlay = ''; // centered labels for sub-groups, rendered outside grp-inner

  // Use full path for data lookup to avoid short-name collision
  const data = scopedPath && scopedPath !== cls ? (classesData[scopedPath] || classesData[cls]) : classesData[cls];
  if (!data?.diagram) return null;

  const parsed = parseFlowchart(data.diagram);
  const {rankdir, nodes, edges} = parsed;
  if (!nodes.length) return null;

  // padding around the group content — must account for edge arrows + labels
  const PAD_L = 24, PAD_R = 50, PAD_T = 24, PAD_B = 40;

  // For level 0: expand @ref nodes as sub-groups
  const subGroups = {}; // nodeId -> { cls, W, H, svgContent }
  const nodeDims  = {}; // nodeId -> { width, height }

  // Determine children of current element for subgroup resolution
  const currentChildren = (level === 0 ? (childrenByPerspective[cls] || []) : (classesData[cls]?.children || []));

  for (const n of nodes) {
    // Resolve subgroup: @ref (legacy) OR node ID is a child of current element with its own diagram
    // Use FULL path to check diagram — avoids short-name collision (e.g. rest-api in multiple perspectives)
    const childFullPath = scopedPath + '/' + n.id;
    const hasOwnDiagram = !n.isRef && currentChildren.includes(n.id) && classesData[childFullPath]?.diagram;
    const refCls = n.isRef ? (n.refTarget || n.id) : (hasOwnDiagram ? n.id : null);
    if (level < maxDepth && refCls && !seen.has(refCls) && !_expandedGlobal.has(refCls)) {
      _expandedGlobal.add(refCls);
      const childScopedPath = scopedPath + '/' + refCls;
      const sub = renderGroup(refCls, classesData, allClasses, level+1, seen, childScopedPath);
      if (sub) {
        // Scale down to fit max box. At small scales, edge overflow becomes negligible.
        const MAX_W = 320, MAX_H = 220, PAD = 12;
        const fs = Math.min((MAX_W - PAD*2) / sub.W, (MAX_H - PAD*2) / sub.H, 1);
        subGroups[n.id] = { cls: refCls, scopedPath: childScopedPath, ...sub, fitScale: fs };
        nodeDims[n.id] = { width: sub.W * fs + PAD * 2, height: sub.H * fs + PAD * 2 };
      }
    }
    if (!nodeDims[n.id]) {
      const lbl = n.label.replace(/^@/,'');
      const parts = lbl.split('\n');
      const mainLbl = parts[0];
      const pathLbl = parts[1] || '';
      const hasPath = lbl.includes('\n');
      const maxW = nodes.length > 10 ? 200 : 260;
      const mainW = tw(mainLbl, '12px Inter,system-ui') + 44;
      const pathW = pathLbl ? tw(pathLbl, '9px SF Mono,Fira Code,monospace') + 32 : 0;
      const w = Math.min(maxW, Math.max(90, Math.max(mainW, pathW)));
      const baseH = n.shape==='diamond' ? 42 : 38;
      nodeDims[n.id] = {width: w, height: hasPath ? baseH + 20 : baseH};
    }
  }

  // Pre-process: identify fan-out groups for compact grid layout
  const maxPerRow = 4;
  const _gridGroups = {};  // virtualId -> { parentId, children[], cols, cellW, cellH }
  const _gridExcluded = new Set();  // node IDs replaced by virtual nodes
  const _gridPositions = {};  // childId -> { x, y } (filled after dagre)

  for (const n of nodes) {
    const outEdges = edges.filter(e => e.from === n.id);
    const leafTargets = outEdges
      .map(e => e.to)
      .filter(tid => !edges.some(e2 => e2.from === tid) && !subGroups[tid]);
    if (leafTargets.length > maxPerRow) {
      const cols = maxPerRow;
      const rows = Math.ceil(leafTargets.length / cols);
      const maxCW = Math.max(...leafTargets.map(id => nodeDims[id].width));
      const maxCH = Math.max(...leafTargets.map(id => nodeDims[id].height));
      const cellW = maxCW + 28;
      const cellH = maxCH + 20;
      const vid = `__grid_${n.id}`;
      _gridGroups[vid] = { parentId: n.id, children: leafTargets, cols, cellW, cellH };
      nodeDims[vid] = { width: cols * cellW, height: rows * cellH };
      leafTargets.forEach(id => _gridExcluded.add(id));
    }
  }

  // Dagre layout with virtual grid nodes
  const dense = nodes.length > 10;
  function buildGraph(rd) {
    const g = new dagre.graphlib.Graph();
    const nsep = dense ? 28 : 36;
    const rsep = dense ? 40 : 48;
    g.setGraph({rankdir: rd, nodesep:nsep, ranksep:rsep, marginx:PAD_L, marginy:PAD_T});
    g.setDefaultEdgeLabel(() => ({}));
    for (const n of nodes) {
      if (!_gridExcluded.has(n.id)) g.setNode(n.id, nodeDims[n.id]);
    }
    for (const vid of Object.keys(_gridGroups)) g.setNode(vid, nodeDims[vid]);
    const _addedVirtEdges = new Set();
    for (const e of edges) {
      let from = e.from, to = e.to;
      if (_gridExcluded.has(from)) continue;
      if (_gridExcluded.has(to)) {
        const vEntry = Object.entries(_gridGroups).find(([,gr]) => gr.children.includes(to));
        if (!vEntry) continue;
        to = vEntry[0];
        const ek = `${from}->${to}`;
        if (_addedVirtEdges.has(ek)) continue;
        _addedVirtEdges.add(ek);
      }
      if (g.hasNode(from) && g.hasNode(to)) g.setEdge(from, to, {label: e.label});
    }
    try { dagre.layout(g); return g; } catch { return null; }
  }

  let g = buildGraph(rankdir);
  if (!g) return null;
  const gi0 = g.graph();
  const aspectThreshold = nodes.length > 12 ? 1.4 : nodes.length > 7 ? 1.6 : 2.0;
  if (gi0.width > 0 && gi0.height > 0 && gi0.width / gi0.height > aspectThreshold && rankdir !== 'TB') {
    const gTB = buildGraph('TB');
    if (gTB) g = gTB;
  }

  // Expand virtual grid nodes into child positions
  for (const [vid, group] of Object.entries(_gridGroups)) {
    const vNode = g.node(vid);
    if (!vNode) continue;
    const { children, cols, cellW, cellH } = group;
    const rows = Math.ceil(children.length / cols);
    const startX = vNode.x - ((cols - 1) * cellW) / 2;
    const startY = vNode.y - ((rows - 1) * cellH) / 2;
    children.forEach((childId, i) => {
      _gridPositions[childId] = {
        x: startX + (i % cols) * cellW,
        y: startY + Math.floor(i / cols) * cellH
      };
    });
  }

  const gi = g.graph();
  const W = r1(gi.width + PAD_R);
  const H = r1(gi.height + PAD_B);

  const uid = `${cls.replace(/[^a-z0-9]/gi,'')}_l${level}_`;
  const th = theme();
  let svg = '';
  let edgeLabels = ''; // collected separately, rendered after nodes (on top)

  // edges
  // Dim edge labels when too many edges, show on hover
  const manyEdges = edges.length > 12;

  edges.forEach((e,i) => {
    if (_gridExcluded.has(e.from)) return; // skip edges from grid children
    let pts, d, mid;
    const srcPos = g.node(e.from) || _gridPositions[e.from];
    const tgtPos = _gridPositions[e.to] || g.node(e.to);
    if (!srcPos || !tgtPos) return;
    if (_gridPositions[e.to]) {
      const mx = (srcPos.x + tgtPos.x) / 2, my = (srcPos.y + tgtPos.y) / 2;
      pts = [{x:srcPos.x,y:srcPos.y},{x:mx,y:my},{x:tgtPos.x,y:tgtPos.y}];
      d = smoothPath(pts);
      mid = {x:mx, y:my};
    } else {
      const ed = g.edge(e.from, e.to); if (!ed?.points?.length) return;
      pts = ed.points;
      d = smoothPath(pts);
      mid = pts[Math.floor(pts.length/2)];
    }
    const ec = th.edgeColor0;
    const mk = `${uid}m${i}`;
    const opacity = manyEdges ? '0.35' : '1';
    const hoverClass = manyEdges ? ' edge-label-dim' : '';
    svg += `<defs><marker id="${mk}" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0.5 L0,4.5 L6,2.5 z" fill="${ec}"/></marker></defs>
      <path class="edge-path" d="${d}" stroke="${ec}" stroke-width="2" fill="none" marker-end="url(#${mk})" data-from="${esc(e.from)}" data-to="${esc(e.to)}"/>`;
    if (e.label) {
      const lw = tw(e.label,'10px Inter')+12;
      const mx=r1(mid.x), my=r1(mid.y);
      edgeLabels += `<g class="edge-label${hoverClass}" opacity="${opacity}"><rect x="${mx-lw/2}" y="${my-8}" width="${lw}" height="16" rx="3" fill="${th.edgeLabelBg}"/>
        <text x="${mx}" y="${my+4}" text-anchor="middle" font-family="Inter,system-ui" font-size="10" fill="${th.edgeLabelText}">${esc(e.label)}</text></g>`;
    }
  });

  // nodes
  for (const n of nodes) {
    const pos = _gridPositions[n.id] || g.node(n.id); if (!pos) continue;
    const dim = nodeDims[n.id];
    const nx = r1(pos.x - dim.width/2);
    const ny = r1(pos.y - dim.height/2);
    const sg = subGroups[n.id];

    if (sg) {
      // ── sub-group: dashed boundary + nested content ──
      const safeId = esc(sg.cls); // short name for display
      const scopedId = esc(sg.scopedPath || sg.cls); // full path for selection
      const refSubStroke = th.subStroke;
      const fs = sg.fitScale;
      const PAD = 12;
      const boxW = sg.W * fs + PAD * 2, boxH = sg.H * fs + PAD * 2;
      const clipId = `${uid}clip_${n.id}`;
      svg += `<defs><clipPath id="${clipId}"><rect x="-2" y="-16" width="${r1(boxW+4)}" height="${r1(boxH+18)}" rx="6"/></clipPath></defs>`;
      svg += `<g class="grp-node" clip-path="url(#${clipId})" onclick="event.stopPropagation();window.__openSb('${scopedId}')" data-cls="${scopedId}" data-depth="${level+1}" transform="translate(${nx},${ny})">`;
      svg += `<rect class="grp-border" width="${r1(boxW)}" height="${r1(boxH)}" rx="5"
        fill="${th.subFill}" stroke="${refSubStroke}" stroke-width="2"/>`;
      const _slW = tw(fmtLabel(sg.cls), '600 9px "Plus Jakarta Sans",Inter,system-ui') + 12;
      svg += `<rect class="grp-label-top grp-label-bg" x="5" y="-7" width="${_slW}" height="14" rx="2" fill="${th.subFill}" opacity="1"/>`;
      svg += `<text class="grp-label-top" x="10" y="2" font-family="&quot;Plus Jakarta Sans&quot;,Inter,system-ui" font-size="9" font-weight="600"
        fill="${th.subLabelFill}" letter-spacing="0.05em">${esc(fmtLabel(sg.cls))}</text>`;
      svg += `<g class="grp-inner" transform="translate(${r1(PAD)},${r1(PAD)}) scale(${r1(fs)})">${sg.svgContent}</g>`;
      svg += `<text class="grp-label-center" x="${r1(boxW/2)}" y="${r1(boxH/2)}" text-anchor="middle" dominant-baseline="central"
        font-family="&quot;Plus Jakarta Sans&quot;,Inter,system-ui" font-size="9" font-weight="600" fill="${th.grpLabelCenterFill}" letter-spacing="0.05em">${esc(fmtLabel(sg.cls))}</text>`;
      svg += `</g>`;
      labelOverlay += `<text class="grp-label-center" x="${r1(nx + boxW/2)}" y="${r1(ny + boxH/2)}" text-anchor="middle" dominant-baseline="central"
        font-family="&quot;Plus Jakarta Sans&quot;,Inter,system-ui" font-size="9" font-weight="600" fill="${th.grpLabelCenterFill}" letter-spacing="0.05em">${esc(fmtLabel(sg.cls))}</text>`;
    } else {
      // ── regular node ──
      const st = nodeStyle(n);
      if (n.label.startsWith('@')) {
        // @ref nodes keep same border as default (white)
        // @ref nodes keep solid border
      }
      const da = st.dash ? `stroke-dasharray="${st.dash}"` : '';
      const rawLbl = n.label.replace(/^@/,'');
      const [mainLbl, pathLbl] = rawLbl.split('\n');
      const cx = r1(pos.x), cy = r1(pos.y);
      const fs = 12;
      const nodeScopedId = esc(scopedPath + '/' + n.id);
      let shape = '';
      if (n.shape==='diamond') {
        shape = `<polygon class="nshape" points="${cx},${ny} ${nx+dim.width},${cy} ${cx},${ny+dim.height} ${nx},${cy}"
          fill="${st.bg}" stroke="${st.border}" stroke-width="2" ${da}/>`;
      } else if (n.shape==='stadium'||n.shape==='round') {
        shape = `<rect class="nshape" x="${nx}" y="${ny}" width="${dim.width}" height="${dim.height}"
          rx="${dim.height/2}" fill="${st.bg}" stroke="${st.border}" stroke-width="2" ${da}/>`;
      } else {
        shape = `<rect class="nshape" x="${nx}" y="${ny}" width="${dim.width}" height="${dim.height}"
          rx="4" fill="${st.bg}" stroke="${st.border}" stroke-width="2" ${da}/>`;
      }
      if (pathLbl) {
        svg += `<g class="reg-node" data-cls="${nodeScopedId}" onclick="event.stopPropagation();window.__openSb('${nodeScopedId}')">${shape}
          <text class="node-lbl" x="${cx}" y="${r1(cy - 7)}" text-anchor="middle" dominant-baseline="central"
            font-family="Inter,system-ui,sans-serif" font-size="${fs}" fill="${st.text}">${esc(mainLbl)}</text>
          <text class="node-path" x="${cx}" y="${r1(cy + 7)}" text-anchor="middle" dominant-baseline="central"
            font-family="'SF Mono','Fira Code',monospace" font-size="9" fill="${st.text}" opacity="0.45">${esc(pathLbl)}</text>
        </g>`;
      } else {
        svg += `<g class="reg-node" data-cls="${nodeScopedId}" onclick="event.stopPropagation();window.__openSb('${nodeScopedId}')">${shape}
          <text class="node-lbl" x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
            font-family="Inter,system-ui,sans-serif" font-size="${fs}" fill="${st.text}">${esc(mainLbl)}</text>
        </g>`;
      }
    }
  }

  // Edge labels rendered last (on top of all nodes)
  svg += edgeLabels;

  return { svgContent: svg, W, H, labelOverlay };
}

// ── mermaid syntax highlighting ────────────────────────────
function highlightMermaid(text) {
  if (!text) return '';
  const escH = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return text.split('\n').map(line => {
    // Comments
    if (/^%%/.test(line)) return `<span class="mk-comment">${escH(line)}</span>`;
    let h = '';
    let rest = line;

    // Graph declaration
    let m = rest.match(/^(graph|flowchart)\s+(\w+)(.*)/i);
    if (m) {
      h += `<span class="mk-keyword">${escH(m[1])}</span> <span class="mk-direction">${escH(m[2])}</span>`;
      rest = m[3];
    }

    // classDef
    m = rest.match(/^\s*(classDef)\s+(\S+)(.*)/i);
    if (m) {
      h += `<span class="mk-keyword">${escH(m[1])}</span> <span class="mk-class">${escH(m[2])}</span>${escH(m[3])}`;
      return h;
    }

    // class assignment
    m = rest.match(/^\s*(class)\s+([\w,\s-]+)\s+(\w+)$/i);
    if (m) {
      h += `<span class="mk-keyword">${escH(m[1])}</span> <span class="mk-node">${escH(m[2])}</span> <span class="mk-class">${escH(m[3])}</span>`;
      return h;
    }

    // Split on edges to process each segment
    const parts = rest.split(/((?:-->|==>|-.->|---|~~>|--o|--x)(?:\|[^|]*\|)?)/g);
    for (const part of parts) {
      // Edge with label
      let em = part.match(/^(-->|==>|-.->|---|~~>|--o|--x)(\|[^|]*\|)$/);
      if (em) {
        h += `<span class="mk-arrow">${escH(em[1])}</span><span class="mk-label">${escH(em[2])}</span>`;
        continue;
      }
      // Edge without label
      if (/^(-->|==>|-.->|---|~~>|--o|--x)$/.test(part)) {
        h += `<span class="mk-arrow">${escH(part)}</span>`;
        continue;
      }
      // Text: escape first, then highlight nodes/labels/refs
      let t = escH(part);
      // @ref nodes
      t = t.replace(/@(\w+)/g, '<span class="mk-ref">@$1</span>');
      // Node with bracket label: id["Label"] — match escaped quotes
      t = t.replace(/(\b[\w-]+)(\[&quot;[^&]*(?:&[^;]+?)*&quot;\])/g, '<span class="mk-node">$1</span><span class="mk-label">$2</span>');
      // Node with paren label: id(Label)
      t = t.replace(/(\b[\w-]+)(\([^)]*\))/g, '<span class="mk-node">$1</span><span class="mk-label">$2</span>');
      // Node with brace label: id{Label}
      t = t.replace(/(\b[\w-]+)(\{[^}]*\})/g, '<span class="mk-node">$1</span><span class="mk-label">$2</span>');
      h += t;
    }
    return h;
  }).join('\n');
}

// ── sidebar diagram renderer (flat, for sidebar only) ─────
function renderFlatSVG(text) {
  if (!text) return null;
  let parsed; try { parsed = parseFlowchart(text); } catch { return null; }
  const {rankdir, nodes, edges} = parsed;
  if (!nodes.length) return null;
  const g = new dagre.graphlib.Graph();
  g.setGraph({rankdir, nodesep:40, ranksep:52, marginx:24, marginy:20});
  g.setDefaultEdgeLabel(() => ({}));
  const dims = {};
  for (const n of nodes) {
    const lbl = n.label.replace(/^@/,'');
    const parts = lbl.split('\n');
    const mainLbl = parts[0];
    const pathLbl = parts[1] || '';
    const hasPath = lbl.includes('\n');
    const mainW = tw(mainLbl,'11px Inter,system-ui') + 28;
    const pathW = pathLbl ? tw(pathLbl,'9px SF Mono,Fira Code,monospace') + 24 : 0;
    const w = Math.min(220, Math.max(70, Math.max(mainW, pathW)));
    const h = (n.shape==='diamond'?34:28) + (hasPath ? 18 : 0);
    dims[n.id]={w,h}; g.setNode(n.id,{width:w,height:h});
  }
  for (const e of edges) { if (g.hasNode(e.from)&&g.hasNode(e.to)) g.setEdge(e.from,e.to,{label:e.label}); }
  try { dagre.layout(g); } catch { return null; }
  const gi = g.graph();
  const W = r1((gi.width||150)+60), H = r1((gi.height||80)+50);
  let edg='', edgLabels='', nds='';
  const sth = theme();
  edges.forEach((e,i) => {
    const ed=g.edge(e.from,e.to); if (!ed?.points?.length) return;
    const pts=ed.points, d=smoothPath(pts);
    const mid=pts[Math.floor(pts.length/2)];
    const mk=`sbm${i}${Math.random().toString(36).slice(2,5)}`;
    edg+=`<defs><marker id="${mk}" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0.5 L0,4.5 L6,2.5 z" fill="${sth.edgeColor0}"/></marker></defs>
      <path class="edge-path" d="${d}" stroke="${sth.edgeColor0}" stroke-width="2" fill="none" marker-end="url(#${mk})" data-from="${esc(e.from)}" data-to="${esc(e.to)}"/>`;
    if (e.label) {
      const lw=tw(e.label,'9px Inter')+8, mx=r1(mid.x), my=r1(mid.y);
      edgLabels+=`<rect x="${mx-lw/2}" y="${my-6}" width="${lw}" height="12" rx="2" fill="${sth.edgeLabelBg}"/>
        <text x="${mx}" y="${my+3}" text-anchor="middle" font-family="Inter,system-ui" font-size="9" fill="${sth.edgeLabelText}">${esc(e.label)}</text>`;
    }
  });
  for (const n of nodes) {
    const pos=g.node(n.id); if (!pos) continue;
    const {w,h}=dims[n.id];
    const nx=r1(pos.x-w/2), ny=r1(pos.y-h/2), cx=r1(pos.x), cy=r1(pos.y);
    const st=nodeStyle(n), da=st.dash?`stroke-dasharray="${st.dash}"`:'';
    const rawLbl=n.label.replace(/^@/,'');
    const [mainLbl, pathLbl]=rawLbl.split('\n');
    let shape='';
    if (n.shape==='diamond') shape=`<polygon points="${cx},${ny} ${nx+w},${cy} ${cx},${ny+h} ${nx},${cy}" fill="${st.bg}" stroke="${st.border}" stroke-width="2" ${da}/>`;
    else if (n.shape==='stadium'||n.shape==='round') shape=`<rect x="${nx}" y="${ny}" width="${w}" height="${h}" rx="${h/2}" fill="${st.bg}" stroke="${st.border}" stroke-width="2" ${da}/>`;
    else shape=`<rect x="${nx}" y="${ny}" width="${w}" height="${h}" rx="4" fill="${st.bg}" stroke="${st.border}" stroke-width="2" ${da}/>`;
    if (pathLbl) {
      nds+=`<g>${shape}
        <text x="${cx}" y="${r1(cy-6)}" text-anchor="middle" dominant-baseline="central"
          font-family="Inter,system-ui" font-size="11" fill="${st.text}">${esc(mainLbl)}</text>
        <text x="${cx}" y="${r1(cy+6)}" text-anchor="middle" dominant-baseline="central"
          font-family="'SF Mono','Fira Code',monospace" font-size="9" fill="${st.text}" opacity="0.45">${esc(pathLbl)}</text>
      </g>`;
    } else {
      nds+=`<g>${shape}<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
        font-family="Inter,system-ui" font-size="11" fill="${st.text}">${esc(mainLbl)}</text></g>`;
    }
  }
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;overflow:visible" xmlns="http://www.w3.org/2000/svg">${edg}${nds}${edgLabels}</svg>`;
}

// ── canvas pan/zoom ───────────────────────────────────────
const canvasWrap = document.getElementById('canvas-wrap');
const canvasEl   = document.getElementById('canvas');
const sidebar    = document.getElementById('sidebar');
const sbTitle    = document.getElementById('sb-title');
const sbDiagram  = document.getElementById('sb-diagram');
const sbFields   = document.getElementById('sb-fields');
const zoomLabel  = document.getElementById('zoom-label');
const navTitle   = document.getElementById('nav-title');
const navList    = document.getElementById('nav-list');

let vpX=0, vpY=0, vpScale=0.7;
let classes=[], classesData={}, refsData={};
let selectedCls=null, svgW=0, svgH=0;
const maxDepth = 6;  // always render all depths; visibility controlled per-group by CSS

const api = p => {
  const sep = p.includes('?') ? '&' : '?';
  // Only append ?project= when viewing from arch-repo (server sets __projectSource)
  const proj = window.__projectSource === 'arch' ? window.__projectName : null;
  const url = proj ? `${p}${sep}project=${encodeURIComponent(proj)}` : p;
  return fetch(url).then(r=>r.json()).catch(()=>({}));
};

// ── transform ──────────────────────────────────────────────
const MIN_SCALE = 0.02, MAX_SCALE = 30;

function applyTransform() {
  canvasEl.style.transform=`translate(${vpX}px,${vpY}px) scale(${vpScale})`;
  const pct = Math.round(vpScale*100);
  zoomLabel.textContent = pct >= 1000 ? `${(pct/100).toFixed(0)}k%` : `${pct}%`;

  // Scale-compensated group labels: keep ~13px rendered size
  const targetPx = 13;
  const fs = Math.min(72, Math.max(10, targetPx / vpScale));
  const fsStr = (Math.round(fs * 10) / 10).toString();
  const labelFill = isDark() ? (vpScale < 0.5 ? '#ccc' : '#cbd5e1') : (vpScale < 0.5 ? '#333' : '#475569');
  document.querySelectorAll('#canvas .grp-label-top').forEach(el => {
    if (el.tagName === 'text') {
      el.setAttribute('font-size', fsStr);
      el.setAttribute('fill', labelFill);
    } else if (el.classList.contains('grp-label-bg')) {
      // Scale background rect height to match font-size
      el.setAttribute('height', String(Math.round(fs * 1.5)));
    }
  });
  // Center label: keep ~20px rendered size in overview
  const fsCtr = Math.min(120, Math.max(14, 20 / vpScale));
  const fsCtrStr = (Math.round(fsCtr * 10) / 10).toString();
  document.querySelectorAll('#canvas .grp-label-center').forEach(el => {
    el.setAttribute('font-size', fsCtrStr);
  });
  // Scale-compensated node labels: keep ~11px rendered size at any zoom level
  const fsNode = Math.min(60, Math.max(11, 11 / vpScale));
  const fsNodeStr = (Math.round(fsNode * 10) / 10).toString();
  document.querySelectorAll('#canvas .node-lbl').forEach(el => {
    el.setAttribute('font-size', fsNodeStr);
  });

  canvasWrap.classList.toggle('zoom-overview', vpScale < 0.42);

  // Viewport-relative expansion: measure group's own border rect
  const vpW = canvasWrap.clientWidth;
  document.querySelectorAll('#canvas [data-depth]').forEach(el => {
    const border = el.querySelector(':scope > .grp-border');
    if (!border) return;
    const rect = border.getBoundingClientRect();
    const depth = parseInt(el.getAttribute('data-depth') || '0', 10);

    // Collapse: hide inner content when group is too small on screen (progressive reveal)
    const collapseThreshold = vpW * 0.275;  // 27.5% of canvas viewport width
    const collapsed = rect.width < collapseThreshold;
    el.classList.toggle('grp-collapsed', collapsed);

    // Expansion: label switching (existing logic)
    // Root=50%, depth1=65%, depth2=80% of viewport width to expand
    const threshold = 0.5 + depth * 0.15;
    const expanded = rect.width >= vpW * threshold;
    el.classList.toggle('grp-expanded', expanded);
  });

}

function zoomTo(newScale, originX, originY) {
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScale));
  const cW = canvasWrap.clientWidth, cH = canvasWrap.clientHeight;
  const cx = originX ?? cW/2, cy = originY ?? cH/2;
  vpX = cx - (cx - vpX) * (s / vpScale);
  vpY = cy - (cy - vpY) * (s / vpScale);
  vpScale = s;
  applyTransform();
}

function centerView() {
  if (!svgW) return;
  if (_raf) { cancelAnimationFrame(_raf); _raf = null; }
  const cW=canvasWrap.clientWidth, cH=canvasWrap.clientHeight;
  const s = Math.min(0.9, (cW-80)/svgW, (cH-80)/svgH);
  vpScale = s;
  vpX = cW/2 - (svgW/2)*s;
  vpY = cH/2 - (svgH/2)*s;
  applyTransform();
}

let _lastZoom = 0;
function throttledZoom(fn) {
  const now = performance.now();
  if (now - _lastZoom < 50) return; // max 20 zoom steps/sec
  _lastZoom = now;
  fn();
}
window.zoomIn    = () => throttledZoom(() => zoomTo(vpScale * 1.25));
window.zoomOut   = () => throttledZoom(() => zoomTo(vpScale / 1.25));
window.resetView = centerView;

// ── animated transition ────────────────────────────────────
let _raf = null;
function animateTo(toX, toY, toScale, duration=380) {
  if (_raf) cancelAnimationFrame(_raf);
  const fromX = vpX, fromY = vpY, fromS = vpScale;
  const t0 = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - t0) / duration);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    vpX = fromX + (toX - fromX) * e;
    vpY = fromY + (toY - fromY) * e;
    vpScale = fromS + (toScale - fromS) * e;
    applyTransform();
    if (t < 1) _raf = requestAnimationFrame(frame);
  }
  _raf = requestAnimationFrame(frame);
}

function focusGroup(cls) {
  // Mark focused group as exempt from blur
  document.querySelectorAll('#canvas [data-cls].focus-exempt').forEach(el => el.classList.remove('focus-exempt'));
  const el = document.querySelector(`#canvas [data-cls="${CSS.escape(cls)}"]`);
  if (!el) return;
  el.classList.add('focus-exempt');
  // Also exempt all ancestor groups so parent blur doesn't hide focused child
  let ancestor = el.parentElement;
  while (ancestor) {
    if (ancestor.hasAttribute && ancestor.hasAttribute('data-cls')) {
      ancestor.classList.add('focus-exempt');
    }
    ancestor = ancestor.parentElement;
  }

  // Get group's SVG-space position directly from its transform attribute.
  // Traverse up to root SVG to accumulate nested translates/scales.
  function getSvgPoint(el) {
    const rect = el.getBoundingClientRect();
    const wrapRect = canvasWrap.getBoundingClientRect();
    // Screen position of element center, relative to canvas-wrap top-left
    const sx = rect.left + rect.width / 2 - wrapRect.left;
    const sy = rect.top + rect.height / 2 - wrapRect.top;
    // Convert to canvas SVG space (reverse pan+zoom transform)
    const svgX = (sx - vpX) / vpScale;
    const svgY = (sy - vpY) / vpScale;
    // Get element dimensions in SVG space
    const w = rect.width / vpScale;
    const h = rect.height / vpScale;
    return { svgX, svgY, w, h };
  }

  const border = el.querySelector(':scope > .grp-border') || el;
  const { svgX, svgY, w, h } = getSvgPoint(border);

  // Available viewport (account for sidebar: right panel on desktop, bottom drawer on mobile)
  const isMobile = window.innerWidth <= 768;
  const sbW = (!isMobile && sidebar.classList.contains('open')) ? sidebar.getBoundingClientRect().width : 0;
  const sbH = (isMobile && sidebar.classList.contains('open')) ? window.innerHeight * 0.5 : 0;
  const availW = canvasWrap.clientWidth - sbW - 60;
  const availH = canvasWrap.clientHeight - sbH - 60;

  // Target scale to fit element with padding
  const targetScale = Math.min(MAX_SCALE, Math.max(0.15, Math.min(availW / w, availH / h) * 0.85));

  // Center in available viewport (account for sidebar/drawer)
  const centerX = (canvasWrap.clientWidth - sbW) / 2;
  const centerY = (canvasWrap.clientHeight - sbH) / 2;
  const finalScale = vpScale >= targetScale ? vpScale : targetScale;

  const toX = centerX - svgX * finalScale;
  const toY = centerY - svgY * finalScale;
  animateTo(toX, toY, finalScale);
}

// ── wheel: Figma-style ─────────────────────────────────────
// trackpad two-finger scroll → pan
// trackpad pinch (ctrlKey) / Ctrl+mousewheel → zoom
canvasWrap.addEventListener('wheel', e => {
  e.preventDefault();
  clearFocusExempt();

  if (e.ctrlKey || e.metaKey) {
    // Zoom — trackpad pinch gives pixel deltas, mouse wheel gives line deltas
    let factor;
    if (e.deltaMode === 0) {
      // trackpad pinch: more responsive
      factor = Math.pow(0.993, e.deltaY);
    } else {
      // mouse wheel: snappier step
      factor = e.deltaY < 0 ? 1.22 : 1/1.22;
    }
    zoomTo(vpScale * factor, e.clientX, e.clientY);
  } else {
    // Pan — respect both axes (trackpad two-finger swipe)
    vpX -= e.deltaX;
    vpY -= e.deltaY;
    applyTransform();
  }
}, { passive: false });

// ── pan: space+drag, middle-mouse, empty-area drag ─────────
let spaceHeld = false;
let panning = false, panA = {}, panV = {};
let dragStarted = false;

function updateCursor() {
  if (panning)      canvasWrap.style.cursor = 'grabbing';
  else if (spaceHeld) canvasWrap.style.cursor = 'grab';
  else              canvasWrap.style.cursor = '';
}

window.addEventListener('keydown', e => {
  // Don't intercept when user is typing in an input
  const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;

  if (e.code === 'Space' && document.activeElement === document.body) {
    e.preventDefault();
    spaceHeld = true;
    updateCursor();
  }
  // Figma keyboard shortcuts
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
    if (e.key === '0') { e.preventDefault(); centerView(); }
    if (e.key === '1') { e.preventDefault(); zoomTo(1); }
    if (e.key === '2') { e.preventDefault(); zoomTo(2); }
    if (e.key === '+' || e.key === '=') { e.preventDefault(); window.zoomIn(); }
    if (e.key === '-') { e.preventDefault(); window.zoomOut(); }
    // Ctrl/Cmd+K — focus search
    if (e.key === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  }
  if (isInput) return; // Don't handle shortcuts while typing
  if (e.key === 'Escape') { closeSidebar(); closeSearch(); searchInput.blur(); }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  if (e.key === 'f' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); centerView(); }
  if (e.key === 't' && !e.metaKey && !e.ctrlKey) { e.preventDefault(); toggleTheme(); rebuildCanvas(); }
  // Arrow keys: navigate elements in the sidebar
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey) {
    navigateElement(e.key === 'ArrowRight' ? 1 : -1);
  }
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') { spaceHeld = false; updateCursor(); }
});

canvasWrap.addEventListener('mousedown', e => {
  const isMiddle = e.button === 1;
  const isSpaceDrag = e.button === 0 && spaceHeld;
  const isLeftDrag = e.button === 0 && !spaceHeld;

  if (isMiddle || isSpaceDrag || isLeftDrag) {
    // Only prevent default for middle-click/space-drag;
    // left-click must NOT preventDefault so browser can dispatch dblclick.
    if (isMiddle || isSpaceDrag) e.preventDefault();
    panning = true;
    // Middle-click and space-drag pan immediately; left-drag waits for threshold
    dragStarted = isMiddle || isSpaceDrag;
    window.__ommDidPan = false;
    panA = { x: e.clientX, y: e.clientY };
    panV = { x: vpX, y: vpY };
    updateCursor();
  }
});

window.addEventListener('mousemove', e => {
  if (!panning) return;
  if (!dragStarted) {
    const dx = Math.abs(e.clientX - panA.x);
    const dy = Math.abs(e.clientY - panA.y);
    if (dx > 8 || dy > 8) { dragStarted = true; window.__ommDidPan = true; }
  }
  if (dragStarted) {
    vpX = panV.x + (e.clientX - panA.x);
    vpY = panV.y + (e.clientY - panA.y);
    applyTransform();
  }
});

window.addEventListener('mouseup', () => {
  if (panning) { panning = false; updateCursor(); }
  if (window.__ommDidPan) {
    setTimeout(() => { window.__ommDidPan = false; }, 0);
  }
});

// Touch: pan + pinch zoom
(function() {
  var touchStart = null, touchDist = null, touchScale = null;
  canvasWrap.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, vpX: vpX, vpY: vpY };
    } else if (e.touches.length === 2) {
      touchStart = null;
      var dx = e.touches[1].clientX - e.touches[0].clientX;
      var dy = e.touches[1].clientY - e.touches[0].clientY;
      touchDist = Math.hypot(dx, dy);
      touchScale = vpScale;
    }
  }, { passive: true });
  canvasWrap.addEventListener('touchmove', function(e) {
    if (e.touches.length === 1 && touchStart) {
      e.preventDefault();
      vpX = touchStart.vpX + (e.touches[0].clientX - touchStart.x);
      vpY = touchStart.vpY + (e.touches[0].clientY - touchStart.y);
      applyTransform();
    } else if (e.touches.length === 2 && touchDist) {
      e.preventDefault();
      var dx = e.touches[1].clientX - e.touches[0].clientX;
      var dy = e.touches[1].clientY - e.touches[0].clientY;
      var newDist = Math.hypot(dx, dy);
      var scale = touchScale * (newDist / touchDist);
      vpScale = Math.min(10, Math.max(0.05, scale));
      applyTransform();
    }
  }, { passive: false });
  canvasWrap.addEventListener('touchend', function() {
    touchStart = null; touchDist = null; touchScale = null;
  });
})();

// close sidebar when clicking empty canvas area
canvasWrap.addEventListener('click', e => {
  if (window.__ommDidPan) {
    e.stopImmediatePropagation();
    return;
  }
  if (!e.target.closest('[onclick]') && !e.target.closest('.float-controls')) closeSidebar();
}, true);

// double-click: zoom to focused group (node), reset on empty area
// Ignore double-clicks on controls (zoom buttons, etc.)
canvasWrap.addEventListener('dblclick', e => {
  if (e.target.closest('.float-controls')) return;
  const node = e.target.closest('.grp-node');
  if (node) {
    const cls = node.dataset.cls;
    if (cls) focusGroup(cls);
  } else {
    centerView();
  }
});

// ── sidebar ───────────────────────────────────────────────
function resolveDataKey(cls) {
  // Prefer the full path if it has diagram data
  if (classesData[cls]?.diagram) return cls;
  // Walk up the path to find nearest ancestor with a diagram
  if (cls.includes('/')) {
    var parts = cls.split('/');
    while (parts.length > 1) {
      parts.pop();
      var ancestor = parts.join('/');
      if (classesData[ancestor]?.diagram) return ancestor;
    }
  }
  // Fallback: short name with diagram
  var shortName = cls.includes('/') ? cls.split('/').pop() : cls;
  if (classesData[shortName]?.diagram) return shortName;
  // Last resort: any key match (even without diagram)
  if (classesData[cls]) return cls;
  if (classesData[shortName]) return shortName;
  if (cls.includes('/')) {
    var p = cls.split('/');
    while (p.length > 1) { p.pop(); var a = p.join('/'); if (classesData[a]) return a; }
  }
  return null;
}

/** Strict resolve for export — no walk-up, no short-name fallback. */
function resolveDataKeyExact(cls) {
  if (classesData[cls]?.diagram) return cls;
  return null;
}

window.__openSb = function(cls) {
  // If in graph view, exit graph mode first
  if (_graphMode) {
    _graphMode = false;
    const btn = document.getElementById('graph-btn');
    if (btn) btn.classList.remove('active');
    rebuildCanvas();
    if (_savedViewport) {
      vpX = _savedViewport.vpX;
      vpY = _savedViewport.vpY;
      vpScale = _savedViewport.vpScale;
      applyTransform();
      _savedViewport = null;
    }
  }

  var dataKey = resolveDataKey(cls);
  if (!dataKey || !classesData[dataKey]) return;
  // highlight using scoped cls for DOM, dataKey for data
  document.querySelectorAll('.grp-node,.reg-node').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll(`[data-cls="${CSS.escape(cls)}"]`).forEach(el=>el.classList.add('selected'));
  selectedCls=cls;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-nav') === cls);
  });
  // Auto-scroll the nav list to show the selected element
  var activeNav = document.querySelector('.nav-item.active');
  if (activeNav) activeNav.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  var sidebarAlreadyOpen = sidebar.classList.contains('open');
  openSidebar(dataKey, cls);
  if (sidebarAlreadyOpen) {
    focusGroup(cls);
  } else {
    setTimeout(() => focusGroup(cls), 260);
  }
  // Cloud mode: notify parent frame of selection
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'class-selected', className: cls }, '*');
  }
};

const floatControls = document.querySelector('.float-controls');

function openSidebar(cls, origCls) {
  if (!origCls) origCls = cls;
  // Use origCls for data (shows the clicked element's fields)
  // Use cls only for diagram rendering (resolved to nearest ancestor with diagram)
  const data=classesData[origCls]||classesData[cls]||{};
  const refs=refsData[origCls]||refsData[cls]||{};
  sbTitle.textContent=fmtLabel(origCls);

  // Render diagram SVG in sidebar with code toggle
  sbDiagram.innerHTML = '';
  if (data.diagram) {
    const svg = renderFlatSVG(data.diagram);
    const codeHtml = highlightMermaid(data.diagram);
    sbDiagram.innerHTML = `
      <div class="sb-diagram-toggle">
        <button class="sb-diagram-tab active" onclick="window.__showDiagramTab('diagram')">Diagram</button>
        <button class="sb-diagram-tab" onclick="window.__showDiagramTab('code')">Code</button>
      </div>
      <div class="sb-diagram-view">${svg || '<div style="padding:16px;color:#666">Could not render diagram</div>'}</div>
      <div class="sb-code-view" style="display:none"><pre class="sb-code-pre">${codeHtml}</pre></div>
    `;
  // Timeline slider if history exists
    const history = data.meta?.diagram_history ?? [];
    if (history.length > 0) {
      const allVersions = [...history, { diagram: data.diagram, at: data.meta?.updated || '', commit: data.meta?.git_commit }];
      window.__timelineVersions = allVersions;
      const sliderHtml = `
        <div class="sb-timeline">
          <div class="sb-timeline-label">Version history (${allVersions.length} versions)</div>
          <input type="range" class="sb-timeline-slider" min="0" max="${allVersions.length - 1}" value="${allVersions.length - 1}" oninput="window.__scrubTimeline(this.value)" />
          <div class="sb-timeline-info" id="sb-timeline-info">Current</div>
        </div>
      `;
      sbDiagram.innerHTML += sliderHtml;
    }
  }

  const md=t=>t?marked.parse(t):'';
  const sec=(title,body,ex='')=>body?`<div class="sb-sec ${ex}"><div class="sb-sec-title">${title}</div><div class="sb-sec-body">${body}</div></div>`:'';
  let html='';

  // Diff toggle button (only when prev_diagram exists)
  if (data.diagram && data.meta?.prev_diagram) {
    html += `<div class="sb-sec"><button id="sb-diff-btn" class="sb-diff-toggle" onclick="window.__toggleDiff('${esc(cls)}')">Show Diff</button></div>`;
  }

  // Validate button (only when diagram exists)
  if (data.diagram) {
    html += `<div class="sb-sec"><button class="sb-diff-toggle" onclick="window.__validateElement('${esc(cls)}')">Validate Diagram</button></div>
      <div id="sb-validate-results"></div>`;
  }

  if (data.meta) {
    const t=data.meta.updated?new Date(data.meta.updated).toLocaleString():'';
    html+=`<div class="sb-sec"><div class="sb-sec-title">Meta</div><div class="sb-meta-text">${t?t+'<br>':''}${data.meta.update_count||0} updates${data.meta.git_branch?` · ${data.meta.git_branch}`:''}${data.meta.git_commit?` · ${data.meta.git_commit}`:''}</div></div>`;
  }

  // Metrics
  const allFields = ['description','diagram','constraint','concern','context','todo','note'];
  const filledFields = allFields.filter(f => data[f] && data[f].trim());
  const coverage = Math.round((filledFields.length / allFields.length) * 100);
  const totalWords = filledFields.reduce((sum, f) => sum + (data[f].trim().split(/\s+/).length), 0);
  const children = data.meta?.children ?? [];
  let diagramNodes = 0, diagramEdges = 0;
  if (data.diagram) {
    try {
      const parsed = parseFlowchart(data.diagram);
      diagramNodes = parsed.nodes.length;
      diagramEdges = parsed.edges.length;
    } catch {}
  }
  const complexity = diagramNodes > 15 ? 'high' : diagramNodes > 8 ? 'medium' : 'low';
  const complexityColor = complexity === 'high' ? '#ef4444' : complexity === 'medium' ? '#fbbf24' : '#22c55e';
  html += `<div class="sb-sec"><div class="sb-sec-title">Metrics</div><div class="sb-metrics">
    <span class="sb-metric"><span class="sb-metric-value">${coverage}%</span> coverage</span>
    <span class="sb-metric"><span class="sb-metric-value">${totalWords}</span> words</span>
    ${diagramNodes ? `<span class="sb-metric"><span class="sb-metric-value">${diagramNodes}N/${diagramEdges}E</span> diagram</span>` : ''}
    ${diagramNodes ? `<span class="sb-metric"><span class="sb-metric-value" style="color:${complexityColor}">${complexity}</span> complexity</span>` : ''}
    ${children.length ? `<span class="sb-metric"><span class="sb-metric-value">${children.length}</span> children</span>` : ''}
  </div></div>`;

  // Tags
  if (data.meta?.tags?.length) {
    const tagHtml = data.meta.tags.map(t => `<span class="sb-tag">${esc(t)}</span>`).join('');
    html += `<div class="sb-sec"><div class="sb-sec-title">Tags</div><div class="sb-tags">${tagHtml}</div></div>`;
  }
  html+=sec('Description',md(data.description));
  html+=sec('Constraints',md(data.constraint));
  html+=sec('Concerns',md(data.concern),'sb-concern');
  html+=sec('Context',md(data.context));
  html+=sec('Todo',md(data.todo));
  html+=sec('Notes',md(data.note));
  const inc=refs.incoming||[], out=refs.outgoing||[];
  if (inc.length||out.length) {
    const links=[
      ...inc.map(r=>{const n=typeof r==='string'?r:r.source_class;return `<span class="sb-ref" onclick="window.__openSb('${esc(n)}')">← ${esc(n)}</span>`;}),
      ...out.map(r=>{const n=typeof r==='string'?r:r.target_class;return `<span class="sb-ref" onclick="window.__openSb('${esc(n)}')">→ ${esc(n)}</span>`;}),
    ].join('');
    html+=`<div class="sb-sec"><div class="sb-sec-title">References</div><div class="sb-refs">${links}</div></div>`;
  }

  // Cross-perspective links: show which perspectives contain this element
  const _shortName = origCls.includes('/') ? origCls.split('/').pop() : origCls;
  const _parents = (parentMap[origCls] || parentMap[_shortName]) || [];
  if (_parents.length > 0) {
    // Build full paths by walking up parentMap for each parent
    function buildFullPaths(childName) {
      const parents = parentMap[childName] || [];
      if (!parents.length) return [childName];
      const result = [];
      for (const p of parents) {
        const grandParents = buildFullPaths(p);
        for (const gp of grandParents) {
          result.push(gp + '/' + childName);
        }
      }
      return result;
    }
    const fullPaths = buildFullPaths(_shortName);
    // Deduplicate and format
    const seen = new Set();
    const _pLinks = fullPaths.filter(p => { if (seen.has(p)) return false; seen.add(p); return true; }).map(function(p) {
      const parts = p.split('/');
      const display = parts.map(fmtLabel).join(' / ');
      return `<span class="sb-ref" onclick="window.__openSb('${esc(p)}')">${esc(display)}</span>`;
    }).join('');
    html += `<div class="sb-sec"><div class="sb-sec-title">In</div><div class="sb-refs">${_pLinks}</div></div>`;
  }
  sbFields.innerHTML=html;
  sidebar.classList.add('open');
  if (floatControls) floatControls.classList.add('sidebar-open');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  if (floatControls) floatControls.classList.remove('sidebar-open');
  document.querySelectorAll('.grp-node,.reg-node').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('#canvas [data-cls].focus-exempt').forEach(el => el.classList.remove('focus-exempt'));
  selectedCls=null;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
}

/** Navigate to next/prev element (arrow key support) */
function navigateElement(dir) {
  const items = document.querySelectorAll('#canvas [data-cls]');
  if (!items.length) return;
  const clsList = Array.from(items).map(el => el.getAttribute('data-cls'));
  const idx = clsList.indexOf(selectedCls);
  let next;
  if (idx < 0) {
    next = dir > 0 ? 0 : clsList.length - 1;
  } else {
    next = (idx + dir + clsList.length) % clsList.length;
  }
  const target = clsList[next];
  if (target) window.__openSb(target);
}

// Mobile: swipe down to close drawer
(function() {
  var startY = 0, currentY = 0, dragging = false;
  sidebar.addEventListener('touchstart', function(e) {
    if (!sidebar.classList.contains('open')) return;
    var t = e.touches[0];
    startY = t.clientY;
    currentY = startY;
    dragging = true;
    sidebar.style.transition = 'none';
  }, { passive: true });
  sidebar.addEventListener('touchmove', function(e) {
    if (!dragging) return;
    currentY = e.touches[0].clientY;
    var dy = currentY - startY;
    if (dy > 0) {
      sidebar.style.transform = 'translateY(' + dy + 'px)';
    }
  }, { passive: true });
  sidebar.addEventListener('touchend', function() {
    if (!dragging) return;
    dragging = false;
    sidebar.style.transition = '';
    var dy = currentY - startY;
    if (dy > 80) {
      closeSidebar();
    } else {
      sidebar.style.transform = '';
    }
  });
})();
function clearFocusExempt() {
  document.querySelectorAll('#canvas [data-cls].focus-exempt').forEach(el => el.classList.remove('focus-exempt'));
}
window.closeSidebar=closeSidebar;

// ── build full canvas SVG ─────────────────────────────────
function buildCanvas(classes, classesData, refsData) {
  _expandedGlobal = new Set(); // reset per render
  // Find top-level classes: those with no incoming @refs from other classes
  // Build outgoing ref counts to handle circular references
  const outCount = {}; // cls -> number of outgoing @refs to other classes
  const inCount = {};  // cls -> number of incoming @refs from other classes
  for (const cls of classes) { outCount[cls] = 0; inCount[cls] = 0; }
  for (const cls of classes) {
    const diagram = classesData[cls]?.diagram || '';
    const refs = [...new Set([...diagram.matchAll(/@([\w-]+)/g)].map(m=>m[1]).filter(r => classes.includes(r)))];
    outCount[cls] = refs.length;
    refs.forEach(r => { inCount[r]++; });
  }
  // Top-level = not referenced, OR referenced but has more outgoing refs than any referrer (cycle breaker)
  let topLevel = classes.filter(c => inCount[c] === 0);
  if (!topLevel.length) {
    // All classes have incoming refs (circular). Pick the one with most outgoing refs as root.
    const maxOut = Math.max(...classes.map(c => outCount[c]));
    topLevel = classes.filter(c => outCount[c] === maxOut);
  }
  const roots = topLevel;

  // Render each top-level group
  const groups = [];
  for (const cls of roots) {
    const g = renderGroup(cls, classesData, classes, 0);
    if (g) groups.push({ cls, ...g });
  }
  if (!groups.length) return null;

  // Grid layout — ceil(sqrt(N)) columns for balanced aspect ratio
  const COLS = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  const GAP_X = 70, GAP_Y = 90, OUTER_PAD = 60;

  // Assign grid positions
  groups.forEach((g, i) => { g._col = i % COLS; g._row = Math.floor(i / COLS); });
  const numRows = Math.ceil(groups.length / COLS);

  // Column widths = max group width in that column
  const colW = Array.from({length: COLS}, (_, c) =>
    Math.max(...groups.filter(g => g._col === c).map(g => g.W)));
  // Row heights = max group height in that row
  const rowH = Array.from({length: numRows}, (_, r) =>
    Math.max(...groups.filter(g => g._row === r).map(g => g.H)));

  // Compute offsets
  const colX = colW.reduce((acc, w, i) => { acc.push(i===0 ? 0 : acc[i-1]+colW[i-1]+GAP_X); return acc; }, []);
  const rowY = rowH.reduce((acc, h, i) => { acc.push(i===0 ? 0 : acc[i-1]+rowH[i-1]+GAP_Y); return acc; }, []);

  const totalW = colX[COLS-1] + colW[COLS-1];
  const totalH = rowY[numRows-1] + rowH[numRows-1];
  const canvasW = r1(totalW + OUTER_PAD*2);
  const canvasH = r1(totalH + OUTER_PAD*2);

  const th = theme();
  let innerSVG = '';
  for (const g of groups) {
    const tx = r1(OUTER_PAD + colX[g._col]);
    const ty = r1(OUTER_PAD + rowY[g._row]);
    innerSVG += `<g class="grp-node" data-cls="${esc(g.cls)}" data-depth="0" transform="translate(${tx},${ty})" onclick="event.stopPropagation();window.__openSb('${esc(g.cls)}')">`;
    innerSVG += `<rect class="grp-border" width="${g.W}" height="${g.H}" rx="8"
      fill="${th.groupFill}" stroke="${th.groupStroke}" stroke-width="2"/>`;
    const _lblW = tw(fmtLabel(g.cls), '600 10px "Plus Jakarta Sans",Inter,system-ui') + 14;
    innerSVG += `<rect class="grp-label-top grp-label-bg" x="6" y="-10" width="${_lblW}" height="20" rx="2" fill="${th.groupFill}" opacity="1"/>`;
    innerSVG += `<text class="grp-label-top" x="12" y="3" font-family="&quot;Plus Jakarta Sans&quot;,Inter,system-ui" font-size="10" font-weight="600"
      fill="${th.grpLabelFill}" letter-spacing="0.05em">${esc(fmtLabel(g.cls))}</text>`;
    innerSVG += `<g class="grp-inner">${g.svgContent}</g>`;
    if (g.labelOverlay) innerSVG += `<g class="grp-sub-labels">${g.labelOverlay}</g>`;
    innerSVG += `<text class="grp-label-center" x="${r1(g.W/2)}" y="${r1(g.H/2)}" text-anchor="middle" dominant-baseline="central"
      font-family="&quot;Plus Jakarta Sans&quot;,Inter,system-ui" font-size="10" font-weight="600" fill="${th.grpLabelCenterFill}" letter-spacing="0.05em">${esc(fmtLabel(g.cls))}</text>`;
    innerSVG += `</g>`;
  }

  return { html: `<svg width="${canvasW}" height="${canvasH}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">${innerSVG}</svg>`, W: canvasW, H: canvasH };
}

// ── post-render: glow filter + edge hover delegation ──────
let _hoverListenerAttached = false;
function postRender() {
  // Insert glow filter into the first SVG's <defs> in #canvas
  const svg = canvasEl.querySelector('svg');
  if (svg) {
    let defs = svg.querySelector('defs');
    if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg','defs'); svg.prepend(defs); }
    // Remove existing glow filter if present (from prior render)
    const existing = defs.querySelector('#glow');
    if (existing) existing.remove();
    defs.insertAdjacentHTML('beforeend',
      '<filter id="glow"><feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur"/>' +
      '<feFlood flood-color="#818cf8" flood-opacity="0.4" result="color"/>' +
      '<feComposite in="color" in2="blur" operator="in" result="shadow"/>' +
      '<feMerge><feMergeNode in="shadow"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    );
  }

  // Attach edge-hover event delegation once (survives innerHTML replacements on canvasEl)
  if (!_hoverListenerAttached) {
    _hoverListenerAttached = true;
    canvasWrap.addEventListener('mouseover', e => {
      const node = e.target.closest('.reg-node, .grp-node');
      if (!node) return;
      const nodeId = node.dataset.cls;
      if (!nodeId) return;
      // Only highlight edges in the same parent group (sibling edges)
      const parentGroup = node.parentElement?.closest('[data-cls]') || node.closest('svg');
      if (!parentGroup) return;
      parentGroup.querySelectorAll('.edge-path').forEach(path => {
        const from = path.dataset.from, to = path.dataset.to;
        const match = from === nodeId || to === nodeId || from === '@'+nodeId || to === '@'+nodeId;
        const edgeParentGroup = path.closest('[data-cls]') || path.closest('svg');
        if (edgeParentGroup !== parentGroup) return;
        if (match) {
          path.classList.add('edge-hl');
        }
      });
    });
    canvasWrap.addEventListener('mouseout', e => {
      const node = e.target.closest('.reg-node, .grp-node');
      if (!node) return;
      document.querySelectorAll('#canvas .edge-path.edge-hl').forEach(path => {
        path.classList.remove('edge-hl');
      });
    });
  }
}

// ── rebuild canvas (depth change) ─────────────────────────
function rebuildCanvas() {
  const result = buildCanvas(classes, classesData, refsData);
  if (!result) return;
  canvasEl.innerHTML = result.html;
  svgW = result.W; svgH = result.H;
  applyTransform(); // re-sync label sizes / blur state
  postRender();
  // restore selected highlight only (no re-focus — user controls viewport after initial focus)
  if (selectedCls) {
    document.querySelectorAll(`[data-cls="${CSS.escape(selectedCls)}"]`)
      .forEach(el => el.classList.add('selected'));
  }
}

// ── nav sidebar tree ─────────────────────────────────────
function buildNavTree() {
  navList.innerHTML = '';
  if (!classes.length) return;

  const navOutCount = {}, navInCount = {};
  for (const c of classes) { navOutCount[c] = 0; navInCount[c] = 0; }
  for (const name of classes) {
    const out = refsData[name]?.outgoing || [];
    const targets = [...new Set(out.map(o => typeof o === 'string' ? o : (o.target_class || o)).filter(r => classes.includes(r)))];
    navOutCount[name] = targets.length;
    targets.forEach(r => { navInCount[r]++; });
  }

  // v2: if any perspective has children, use perspective nav with nested items
  const hasNested = Object.values(childrenByPerspective).some(c => c && c.length > 0);
  if (hasNested) {
    function addNavChildren(parentScopedPath, children, basePrefix) {
      children.forEach(function(child, j) {
        var isLast = j === children.length - 1;
        var childScoped = parentScopedPath + '/' + child;
        addNavItem(childScoped, basePrefix, isLast, child);
        // Recurse: check if this child has sub-children in classesData
        var childData = classesData[child];
        if (childData && childData.children && childData.children.length > 0) {
          var subPrefix = basePrefix + (isLast ? '   ' : '│  ');
          addNavChildren(childScoped, childData.children, subPrefix);
        }
      });
    }
    originalPerspectives.forEach((persp, i) => {
      const isLastPersp = i === originalPerspectives.length - 1;
      const children = childrenByPerspective[persp] || [];
      const hasChildren = children.length > 0;

      // Create perspective row with expand/fold toggle
      const btn = document.createElement('button');
      btn.setAttribute('data-nav', persp);
      btn.className = 'nav-item nav-root';
      btn.onclick = () => { window.__openSb(persp); if(window.innerWidth<=768){var n=document.getElementById('nav-sidebar'),o=document.getElementById('mobile-overlay');if(n)n.classList.remove('mobile-open');if(o)o.classList.remove('show');} };

      if (hasChildren) {
        const toggle = document.createElement('span');
        toggle.className = 'nav-toggle';
        toggle.textContent = '▾';
        toggle.style.cssText = 'cursor:pointer;margin-right:6px;font-size:13px;color:inherit;user-select:none';
        toggle.onclick = function(e) {
          e.stopPropagation();
          const container = btn.nextElementSibling;
          if (!container) return;
          const collapsed = container.style.display === 'none';
          container.style.display = collapsed ? '' : 'none';
          toggle.textContent = collapsed ? '▾' : '▸';
        };
        btn.appendChild(toggle);
      }

      const labelSpan = document.createElement('span');
      labelSpan.textContent = persp;
      btn.appendChild(labelSpan);
      navList.appendChild(btn);

      if (hasChildren) {
        const container = document.createElement('div');
        container.className = 'nav-persp-children';
        var childPrefix = isLastPersp ? '   ' : '│  ';
        // Collect children into container by temporarily redirecting addNavItem
        const origAppend = navList.appendChild.bind(navList);
        const tempItems = [];
        addNavChildren(persp, children, childPrefix);
        // Move the just-appended children from navList into container
        while (navList.lastChild && navList.lastChild !== btn) {
          container.insertBefore(navList.lastChild, container.firstChild);
        }
        navList.appendChild(container);
      }
    });
    return;
  }

  let roots = classes.filter(c => navInCount[c] === 0);
  if (roots.length === 0) {
    // Circular refs — pick class with most outgoing refs as root
    const maxOut = Math.max(...classes.map(c => navOutCount[c]));
    roots = classes.filter(c => navOutCount[c] === maxOut);
  }
  if (roots.length === classes.length) {
    classes.forEach(c => addNavItem(c, '', true));
    return;
  }

  const globalSeen = new Set();
  function renderNode(name, prefix, isLast) {
    if (globalSeen.has(name)) return;
    globalSeen.add(name);
    addNavItem(name, prefix, isLast);
    const out = (refsData[name]?.outgoing || [])
      .map(o => typeof o === 'string' ? o : (o.target_class || o))
      .filter(ref => classes.includes(ref) && !globalSeen.has(ref));
    out.forEach((ref, i) => {
      renderNode(ref, prefix + (isLast ? '   ' : '│  '), i === out.length - 1);
    });
  }
  roots.forEach((r, i) => renderNode(r, '', i === roots.length - 1));
}

function addNavItem(name, prefix, isLast, displayLabel) {
  const btn = document.createElement('button');
  btn.setAttribute('data-nav', name);
  btn.onclick = () => { window.__openSb(name); if(window.innerWidth<=768){var n=document.getElementById('nav-sidebar'),o=document.getElementById('mobile-overlay');if(n)n.classList.remove('mobile-open');if(o)o.classList.remove('show');} };

  if (prefix === '') {
    btn.className = 'nav-item nav-root';
    btn.textContent = displayLabel || name;
  } else {
    btn.className = 'nav-item';
    const pre = document.createElement('span');
    pre.className = 'nav-pre';
    // Each slot is 3 chars ("│  " or "   ")
    for (let i = 0; i < prefix.length; i += 3) {
      const slot = document.createElement('span');
      slot.className = 'nav-slot' + (prefix[i] === '│' ? ' nav-slot-line' : '');
      pre.appendChild(slot);
    }
    const conn = document.createElement('span');
    conn.className = 'nav-conn' + (isLast ? ' nav-conn-last' : '');
    pre.appendChild(conn);
    btn.appendChild(pre);
    const label = document.createElement('span');
    label.className = 'nav-label';
    label.textContent = displayLabel || name;
    btn.appendChild(label);
  }

  navList.appendChild(btn);
}

// ── nested element support ────────────────────────────────
var childrenByPerspective = {};
var parentMap = {};
var originalPerspectives = []; // top-level only, before short names pollute classes

async function loadNodeData(perspective, childName) {
  var key = perspective + '/' + childName;
  if (classesData[key]) return classesData[key];
  var data = await api('/api/class/' + perspective + '/node/' + childName);
  if (data && !data.error) {
    classesData[key] = data;
    // Short name: only overwrite if new data has a diagram, or existing has none
    // This prevents a no-diagram entry from clobbering one that has a diagram
    if (data.diagram || !classesData[childName]?.diagram) {
      classesData[childName] = data;
    }
    // Update childrenByPerspective and parentMap for nested children
    if (data.children && data.children.length > 0) {
      childrenByPerspective[key] = data.children;
      for (const child of data.children) {
        if (!parentMap[child]) parentMap[child] = [];
        if (!parentMap[child].includes(key)) parentMap[child].push(key);
      }
      var subLoads = [];
      for (var sub of data.children) {
        subLoads.push(loadSubNodeData(perspective, childName + '/' + sub, sub));
      }
      await Promise.all(subLoads);
    }
  }
  return data;
}

async function loadSubNodeData(perspective, subPath, shortName) {
  if (classesData[perspective + '/' + subPath]) return;
  var data = await api('/api/class/' + perspective + '/node/' + subPath);
  if (data && !data.error) {
    var fullKey = perspective + '/' + subPath;
    classesData[fullKey] = data;
    // Short name: only overwrite if new data has a diagram, or existing has none
    if (data.diagram || !classesData[shortName]?.diagram) {
      classesData[shortName] = data;
    }
    // Update childrenByPerspective and parentMap for deeper nested children
    if (data.children && data.children.length > 0) {
      childrenByPerspective[fullKey] = data.children;
      for (const child of data.children) {
        if (!parentMap[child]) parentMap[child] = [];
        if (!parentMap[child].includes(fullKey)) parentMap[child].push(fullKey);
      }
      var deepLoads = [];
      for (var sub of data.children) {
        deepLoads.push(loadSubNodeData(perspective, subPath + '/' + sub, sub));
      }
      await Promise.all(deepLoads);
    }
  }
}

// ── init ──────────────────────────────────────────────────
async function init() {
  applyTheme();
  classes = await api('/api/classes');
  if (!classes.length) {
    canvasEl.innerHTML=`<div class="empty-state" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)"><p>No perspectives found.<br>Run <code>/omm-scan</code> in Claude Code.</p></div>`;
    return;
  }
  const [da,ra,na] = await Promise.all([
    Promise.all(classes.map(c=>api(`/api/class/${c}`))),
    Promise.all(classes.map(c=>api(`/api/class/${c}/refs`))),
    Promise.all(classes.map(c=>api(`/api/class/${c}/nodes`))),
  ]);
  originalPerspectives = [...classes];
  classes.forEach((c,i)=>{
    classesData[c]=da[i];
    refsData[c]=ra[i];
    childrenByPerspective[c]=(na[i]&&na[i].children)||[];
  });

  // Build reverse map: child -> [parent perspectives] for cross-linking -- uses module-scoped parentMap
  for (const persp of Object.keys(childrenByPerspective)) {
    for (const child of childrenByPerspective[persp]) {
      if (!parentMap[child]) parentMap[child] = [];
      parentMap[child].push(persp);
    }
  }

  // Pre-load nested element data for all children
  const nodeLoads = [];
  for (const persp of Object.keys(childrenByPerspective)) {
    for (const child of childrenByPerspective[persp]) {
      nodeLoads.push(loadNodeData(persp, child));
    }
  }
  await Promise.all(nodeLoads);

  // Set project name and build nav tree
  var projName = window.__projectName || 'omm';
  navTitle.textContent = projName;
  var mobileTitle = document.getElementById('mobile-title');
  if (mobileTitle) mobileTitle.textContent = projName;
  buildNavTree();
  autoSizeNav();

  const result = buildCanvas(originalPerspectives, classesData, refsData);
  if (result) {
    canvasEl.innerHTML = result.html;
    svgW = result.W; svgH = result.H;
  }
  postRender();
  requestAnimationFrame(centerView);

  // Cloud mode: notify parent frame of available classes
  if (window.parent !== window) {
    window.parent.postMessage({ type: 'classes-loaded', classes: classes, refs: refsData }, '*');
  }

  // Cloud mode: listen for parent frame messages
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'select-class') {
      var className = e.data.className;
      if (typeof window.__openSb === 'function') {
        window.__openSb(className);
      }
    }
  });
}

window.toggleMobileNav = function() {
  const nav = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const isOpen = nav.classList.contains('mobile-open');
  nav.classList.toggle('mobile-open', !isOpen);
  overlay.classList.toggle('show', !isOpen);
};

// ── nav sidebar: resize + collapse ─────────────────────
const navSidebar = document.getElementById('nav-sidebar');
const navResize = document.getElementById('nav-resize');
function setNavWidth(px) {
  const clamped = Math.max(140, Math.min(420, px));
  document.documentElement.style.setProperty('--nav-w', clamped + 'px');
}

/** Auto-size nav sidebar to fit the longest item text. */
function autoSizeNav() {
  const items = navList.querySelectorAll('.nav-item');
  let maxW = 0;
  const measure = document.createElement('span');
  measure.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
  document.body.appendChild(measure);
  items.forEach(item => {
    measure.style.font = getComputedStyle(item).font;
    measure.textContent = item.textContent;
    maxW = Math.max(maxW, measure.getBoundingClientRect().width);
  });
  measure.remove();
  // Add padding for the tree prefix + scrollbar
  const targetW = Math.ceil(maxW) + 48;
  const clamped = Math.max(200, Math.min(420, targetW));
  document.documentElement.style.setProperty('--nav-w', clamped + 'px');
}

// Drag resize
let navDragging = false, navStartX = 0, navStartW = 0;
navResize.addEventListener('mousedown', (e) => {
  navDragging = true;
  navStartX = e.clientX;
  navStartW = navSidebar.getBoundingClientRect().width;
  navResize.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!navDragging) return;
  setNavWidth(navStartW + (e.clientX - navStartX));
});
document.addEventListener('mouseup', () => {
  if (!navDragging) return;
  navDragging = false;
  navResize.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// Keep search results positioned next to the sidebar
function updateSearchResultsPos() {
  const w = navSidebar.getBoundingClientRect().width;
  searchResults.style.left = w + 'px';
}
const navResizeObserver = new ResizeObserver(updateSearchResultsPos);
navResizeObserver.observe(navSidebar);

// ── right sidebar resize ────────────────────────────────
const sbResize = document.getElementById('sb-resize');
if (sbResize) {
  let sbDragging = false, sbStartX = 0, sbStartW = 0;
  sbResize.addEventListener('mousedown', (e) => {
    sbDragging = true;
    sbStartX = e.clientX;
    sbStartW = sidebar.getBoundingClientRect().width;
    sbResize.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!sbDragging) return;
    // Dragging left increases width (sidebar is right-aligned)
    const newW = Math.max(280, Math.min(700, sbStartW - (e.clientX - sbStartX)));
    document.documentElement.style.setProperty('--sidebar-w', newW + 'px');
  });
  document.addEventListener('mouseup', () => {
    if (!sbDragging) return;
    sbDragging = false;
    sbResize.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
}

// ── search ──────────────────────────────────────────────
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let srActiveIdx = -1;
let srItems = [];
let searchDebounce = null;

function closeSearch() {
  searchResults.classList.remove('open');
  searchResults.innerHTML = '';
  srItems = [];
  srActiveIdx = -1;
}

function highlightActive() {
  srItems.forEach((el, i) => el.classList.toggle('active', i === srActiveIdx));
  if (srActiveIdx >= 0 && srItems[srActiveIdx]) {
    srItems[srActiveIdx].scrollIntoView({ block: 'nearest' });
  }
}

async function runSearch(query) {
  if (!query.trim()) {
    closeSearch();
    return;
  }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    renderSearchResults(data);
  } catch { closeSearch(); }
}

function renderSearchResults(data) {
  searchResults.innerHTML = '';
  srItems = [];
  srActiveIdx = -1;
  updateSearchResultsPos();

  if (data.featured && data.results.length) {
    const label = document.createElement('div');
    label.className = 'sr-featured';
    label.textContent = 'Perspectives';
    searchResults.appendChild(label);
    for (const r of data.results) {
      const item = createSrItem(r, false);
      searchResults.appendChild(item);
    }
  } else if (data.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sr-empty';
    empty.textContent = 'No results';
    searchResults.appendChild(empty);
  } else {
    for (const r of data.results) {
      const item = createSrItem(r, true);
      searchResults.appendChild(item);
    }
    const count = document.createElement('div');
    count.className = 'sr-count';
    count.textContent = `${data.total} result${data.total !== 1 ? 's' : ''}`;
    searchResults.appendChild(count);
  }
  searchResults.classList.add('open');
}

function createSrItem(r, showSnippet) {
  const item = document.createElement('div');
  item.className = 'sr-item';
  item.dataset.cls = r.elementPath;
  let html = `<div class="sr-item-header"><span class="sr-path">${escHtml(r.elementPath)}</span><span class="sr-field">${escHtml(r.field)}</span></div>`;
  if (showSnippet && r.snippet) {
    html += `<div class="sr-snippet">${r.snippet}</div>`;
  }
  item.innerHTML = html;
  item.addEventListener('click', () => {
    closeSearch();
    searchInput.value = '';
    if (typeof window.__openSb === 'function') window.__openSb(r.elementPath);
  });
  srItems.push(item);
  return item;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => runSearch(searchInput.value), 200);
});

searchInput.addEventListener('keydown', (e) => {
  if (!searchResults.classList.contains('open')) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    srActiveIdx = Math.min(srActiveIdx + 1, srItems.length - 1);
    highlightActive();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    srActiveIdx = Math.max(srActiveIdx - 1, -1);
    highlightActive();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (srActiveIdx >= 0 && srItems[srActiveIdx]) {
      srItems[srActiveIdx].click();
    } else if (srItems.length) {
      srItems[0].click();
    }
  } else if (e.key === 'Escape') {
    closeSearch();
    searchInput.blur();
  }
});

searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) runSearch(searchInput.value);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#search-box') && !e.target.closest('#search-results')) closeSearch();
});


// ── window globals for inline onclick handlers ────────────
window.toggleTheme = function() { toggleTheme(); rebuildCanvas(); };
window.__showDiagramTab = function(tab) {
  const container = document.getElementById('sb-diagram');
  if (!container) return;
  container.querySelectorAll('.sb-diagram-tab').forEach((t, i) => {
    t.classList.toggle('active', (tab === 'diagram' && i === 0) || (tab === 'code' && i === 1));
  });
  const diagramView = container.querySelector('.sb-diagram-view');
  const codeView = container.querySelector('.sb-code-view');
  if (diagramView) diagramView.style.display = tab === 'diagram' ? 'block' : 'none';
  if (codeView) codeView.style.display = tab === 'code' ? 'block' : 'none';
};
window.__scrubTimeline = function(idx) {
  const versions = window.__timelineVersions;
  if (!versions) return;
  const v = versions[idx];
  if (!v) return;
  const container = document.getElementById('sb-diagram');
  if (!container) return;
  const diagramView = container.querySelector('.sb-diagram-view');
  const codeView = container.querySelector('.sb-code-view');
  const info = document.getElementById('sb-timeline-info');
  // Reset diff state when scrubbing
  if (_diffActive) {
    _diffActive = false;
    const diffBtn = document.getElementById('sb-diff-btn');
    if (diffBtn) { diffBtn.textContent = 'Show Diff'; diffBtn.classList.remove('active'); }
  }
  if (diagramView) {
    const svg = renderFlatSVG(v.diagram);
    diagramView.innerHTML = svg || '<div style="padding:16px;color:#666">Could not render diagram</div>';
  }
  if (codeView) {
    codeView.querySelector('pre').innerHTML = highlightMermaid(v.diagram);
  }
  if (info) {
    const isLast = idx === versions.length - 1;
    const date = v.at ? new Date(v.at).toLocaleString() : '';
    info.textContent = isLast ? 'Current' : `${date}${v.commit ? ' · ' + v.commit : ''}`;
  }
};
window.__validateElement = async function(cls) {
  const container = document.getElementById('sb-validate-results');
  if (!container) return;
  container.innerHTML = '<div style="padding:4px 0;font-size:11px;color:#666">Validating…</div>';
  try {
    const res = await fetch(`/api/class/${encodeURIComponent(cls)}/validate`);
    const data = await res.json();
    if (!data.issues?.length) {
      container.innerHTML = '<div class="sb-validate-ok">✓ Valid — no issues</div>';
      return;
    }
    const errors = data.issues.filter(i => i.level === 'error');
    const warnings = data.issues.filter(i => i.level === 'warning');
    let html = '';
    if (errors.length) {
      html += `<div class="sb-validate-section sb-validate-errors">${errors.length} error${errors.length > 1 ? 's' : ''}</div>`;
      for (const issue of errors) {
        const loc = issue.line ? `:${issue.line}` : '';
        html += `<div class="sb-validate-issue sb-validate-error"><span class="sb-validate-rule">${issue.rule}${loc}</span> ${esc(issue.message)}</div>`;
      }
    }
    if (warnings.length) {
      html += `<div class="sb-validate-section sb-validate-warnings">${warnings.length} warning${warnings.length > 1 ? 's' : ''}</div>`;
      for (const issue of warnings) {
        const loc = issue.line ? `:${issue.line}` : '';
        html += `<div class="sb-validate-issue sb-validate-warning"><span class="sb-validate-rule">${issue.rule}${loc}</span> ${esc(issue.message)}</div>`;
      }
    }
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<div style="padding:4px 0;font-size:11px;color:#ef4444">Validation failed</div>';
  }
};
window.toggleMobileNav = function() {
  const nav = document.getElementById('nav-sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const isOpen = nav.classList.contains('mobile-open');
  nav.classList.toggle('mobile-open', !isOpen);
  overlay.classList.toggle('show', !isOpen);
};

// ── diff toggle ──────────────────────────────────────────
let _diffActive = false;
window.__toggleDiff = async function(cls) {
  const btn = document.getElementById('sb-diff-btn');
  const diagramView = document.querySelector('#sb-diagram .sb-diagram-view');
  if (!diagramView) return;

  if (_diffActive) {
    _diffActive = false;
    if (btn) { btn.textContent = 'Show Diff'; btn.classList.remove('active'); }
    const data = classesData[cls];
    diagramView.innerHTML = data?.diagram ? (renderFlatSVG(data.diagram) || '') : '';
    return;
  }
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
  try {
    const res = await fetch(`/api/class/${encodeURIComponent(cls)}/diff`);
    const diff = await res.json();
    if (!diff.has_changes) {
      diagramView.innerHTML = (renderFlatSVG(classesData[cls]?.diagram) || '') + '<div style="padding:8px;text-align:center;color:#666;font-size:12px">No changes detected</div>';
      if (btn) { btn.textContent = 'No Changes'; btn.disabled = false; }
      return;
    }
    _diffActive = true;
    if (btn) { btn.textContent = 'Hide Diff'; btn.classList.add('active'); btn.disabled = false; }
    let svg = renderFlatSVG(diff.current_diagram);
    if (!svg) return;
    const addedNodes = new Set(diff.added_nodes || []);
    const diffStyles = `<defs><style>
      .diff-added .nshape { stroke: #22c55e !important; stroke-width: 3px !important; filter: drop-shadow(0 0 4px rgba(34,197,94,0.5)); }
      .diff-removed .nshape { stroke: #ef4444 !important; stroke-width: 3px !important; stroke-dasharray: 6 3 !important; opacity: 0.6; }
      .diff-added text { fill: #86efac !important; }
      .diff-removed text { fill: #fca5a5 !important; }
    </style></defs>`;
    svg = svg.replace(/^(<svg[^>]*>)/, '$1' + diffStyles);
    for (const nodeId of addedNodes) {
      const safeId = nodeId.replace(/[^a-z0-9_-]/gi, '');
      svg = svg.replace(new RegExp(`(<g[^>]*data-cls="[^"]*${safeId}[^"]*")`, 'g'), '$1 class="diff-added"');
    }
    let html = svg;
    if (diff.removed_nodes?.length) {
      const removedHtml = diff.removed_nodes.map(n => `<span style="color:#ef4444;text-decoration:line-through">${esc(n)}</span>`).join(', ');
      html += `<div style="padding:8px 16px;font-size:11px;color:#999;border-top:1px solid #222">Removed: ${removedHtml}</div>`;
    }
    diagramView.innerHTML = html;
  } catch {
    if (btn) { btn.textContent = 'Error'; btn.disabled = false; }
  }
};

function setupLiveReload() {
  if (!window.EventSource) return;
  try {
    const sse = new EventSource('/events');
    sse.addEventListener('change', async () => {
      const sel = selectedCls;
      await init();
      if (sel && classes.includes(sel)) window.__openSb(sel);
    });
  } catch {}
}

// ── relationship graph view ───────────────────────────────
let _graphMode = false;
let _savedViewport = null; // { vpX, vpY, vpScale }
window.toggleGraphView = async function() {
  const btn = document.getElementById('graph-btn');
  if (_graphMode) {
    _graphMode = false;
    if (btn) btn.classList.remove('active');
    rebuildCanvas();
    // Restore previous viewport
    if (_savedViewport) {
      vpX = _savedViewport.vpX;
      vpY = _savedViewport.vpY;
      vpScale = _savedViewport.vpScale;
      applyTransform();
      _savedViewport = null;
    }
    return;
  }

  // Save current viewport before switching to graph
  _savedViewport = { vpX, vpY, vpScale };
  _graphMode = true;
  if (btn) { btn.classList.add('active'); btn.textContent = '◇'; }

  // Build ref graph: find cross-perspective connections by matching
  // diagram node IDs against children of other perspectives
  const refGraph = [];
  const seen = new Set();

  // Build a set of all known element paths (perspective + nested)
  const allPaths = new Set();
  for (const persp of Object.keys(childrenByPerspective)) {
    allPaths.add(persp);
    for (const child of childrenByPerspective[persp]) {
      allPaths.add(child);
      allPaths.add(persp + '/' + child);
    }
  }

  for (const cls of classes) {
    const diagram = classesData[cls]?.diagram;
    if (!diagram) continue;

    // Extract node IDs from the mermaid diagram
    const parsed = parseFlowchart(diagram);
    for (const node of parsed.nodes) {
      const nodeId = node.id;
      // Skip self-references
      if (nodeId === cls) continue;

      // Check if this node ID matches a child of another perspective
      for (const otherPersp of classes) {
        if (otherPersp === cls) continue;
        const children = childrenByPerspective[otherPersp] || [];
        if (children.includes(nodeId)) {
          const key = cls + '->' + otherPersp;
          if (!seen.has(key)) {
            seen.add(key);
            refGraph.push({ source_class: cls, target_class: otherPersp });
          }
        }
      }
    }
  }

  if (!refGraph.length) {
    canvasEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#666" font-size="14">No cross-perspective references found</text>';
    return;
  }
  renderGraphView(refGraph);
};

function renderGraphView(refs) {
  if (!refs.length) {
    canvasEl.innerHTML = '<text x="50%" y="50%" text-anchor="middle" fill="#666" font-size="14">No cross-perspective references found</text>';
    return;
  }

  // Build unique node list from refs
  const nodeSet = new Set();
  refs.forEach(r => { nodeSet.add(r.source_class); nodeSet.add(r.target_class); });
  const nodes = [...nodeSet];

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 48, ranksep: 64, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  const th = themeColors();

  for (const n of nodes) {
    const w = Math.max(100, tw(fmtLabel(n), '600 11px Plus Jakarta Sans,Inter,system-ui') + 32);
    g.setNode(n, { width: w, height: 36 });
  }
  for (const r of refs) {
    g.setEdge(r.source_class, r.target_class);
  }

  try { dagre.layout(g); } catch { return; }
  const gi = g.graph();
  const W = (gi.width || 400) + 80;
  const H = (gi.height || 300) + 80;

  let svg = '';

  // Edges
  refs.forEach((r, i) => {
    const ed = g.edge(r.source_class, r.target_class);
    if (!ed?.points?.length) return;
    const d = smoothPath(ed.points);
    const mk = `gm${i}`;
    svg += `<defs><marker id="${mk}" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse">
      <path d="M0,0.5 L0,4.5 L6,2.5 z" fill="${th.edgeColor0}"/></marker></defs>
      <path class="edge-path" d="${d}" stroke="${th.edgeColor0}" stroke-width="1.5" fill="none" marker-end="url(#${mk})" opacity="0.6"/>`;
  });

  // Nodes
  for (const n of nodes) {
    const pos = g.node(n); if (!pos) continue;
    const w = pos.width, h = pos.height;
    const nx = pos.x - w/2, ny = pos.y - h/2;
    const isTopLevel = classes.includes(n);
    const fill = isTopLevel ? th.groupFill : th.subFill;
    const stroke = isTopLevel ? th.groupStroke : th.subStroke;
    svg += `<g class="grp-node" data-cls="${esc(n)}" onclick="event.stopPropagation();window.__openSb('${esc(n)}')" style="cursor:pointer">
      <rect class="grp-border" x="${nx}" y="${ny}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
      <text x="${pos.x}" y="${pos.y + 4}" text-anchor="middle" font-family="Plus Jakarta Sans,Inter,system-ui" font-size="11" font-weight="600" fill="${th.grpLabelFill}">${esc(fmtLabel(n))}</text>
    </g>`;
  }

  canvasEl.innerHTML = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">${svg}</svg>`;
  svgW = W; svgH = H;
  requestAnimationFrame(centerView);
}

// ── export ────────────────────────────────────────────────
setupExport(() => selectedCls, () => classesData, renderFlatSVG);

// ── init ──────────────────────────────────────────────────
initTheme();

// Show home button when viewing from arch-repo
if (window.__projectSource === 'arch') {
  const homeBtn = document.getElementById('home-btn');
  if (homeBtn) homeBtn.style.display = '';
}

setupLiveReload();
init();
