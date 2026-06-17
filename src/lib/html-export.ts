import type { ClassData, FlowDef } from '../types.js';
import { readFlows } from './store.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Safe JSON for embedding in <script> tags — escapes < to \u003c and </script> to <\/script
const safeJson = (obj: unknown): string => JSON.stringify(obj)
  .replace(/</g, '\\u003c')
  .replace(/<\/(script)/gi, '<\\/$1');

interface ExportData {
  element: string;
  title: string;
  data: ClassData;
  flows: FlowDef[];
  children: Record<string, ClassData>;
}

export function generateHtmlExport(exp: ExportData): string {
  const { element, title, data, flows, children } = exp;

  // Build detail data for nodes
  const nodeDetails: Record<string, { description?: string; context?: string; concern?: string; constraint?: string }> = {};
  for (const [name, child] of Object.entries(children)) {
    nodeDetails[name] = {
      description: child.description || undefined,
      context: child.context || undefined,
      concern: child.concern || undefined,
      constraint: child.constraint || undefined,
    };
  }
  // Add the element itself
  nodeDetails[element] = {
    description: data.description || undefined,
    context: data.context || undefined,
    concern: data.concern || undefined,
    constraint: data.constraint || undefined,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<script>
(function(){
  var s=null;try{s=localStorage.getItem('omm-theme')}catch(e){}
  var dark=s?s==='dark':window.matchMedia('(prefers-color-scheme:light)').matches===false;
  if(!dark)document.documentElement.classList.add('light');
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"></script>
<style>
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#000;--surface:#0d0d0d;--surface2:#111;--surface3:#141414;
  --border:#333;--border-subtle:#222;--border-muted:#1a1a1a;
  --text:#fff;--text-body:#ccc;--text-mid:#aaa;--text-dim:#888;--text-muted:#666;--text-faint:#555;--text-ghost:#444;
  --accent:#818cf8;--accent-soft:rgba(129,140,248,0.3);--accent-glow:rgba(129,140,248,0.6);
  --success:#22c55e;--error:#ef4444;--warning:#fbbf24;
  --serif:ui-serif,Georgia,"Times New Roman",serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
  --node-external-bg:#313244;--node-external-border:#585b70;--node-external-text:#cdd6f4;
  --node-concern-bg:#45233a;--node-concern-border:#f38ba8;--node-concern-text:#f38ba8;
  --node-entry-bg:#1e3a5f;--node-entry-border:#89b4fa;--node-entry-text:#89b4fa;
  --node-store-bg:#1e3a2e;--node-store-border:#a6e3a1;--node-store-text:#a6e3a1;
  --node-default-bg:#18181b;--node-default-border:#3f3f46;--node-default-text:#e4e4e7;
  --svg-group-fill:#0a0a0a;--svg-group-stroke:#666;
  --svg-edge-0:#909090;--svg-edge-label-bg:#000;--svg-edge-label-text:#aaa;
}
html.light{
  --bg:#f0f0f0;--surface:#fff;--surface2:#f5f5f5;--surface3:#f5f5f5;
  --border:#ddd;--border-subtle:#ddd;--border-muted:#eee;
  --text:#1a1a1a;--text-body:#555;--text-mid:#888;--text-dim:#aaa;--text-muted:#999;--text-faint:#bbb;--text-ghost:#ccc;
  --accent:#4f46e5;--accent-soft:rgba(79,70,229,0.2);--accent-glow:rgba(79,70,229,0.4);
  --success:#16a34a;--error:#dc2626;--warning:#d97706;
  --node-external-bg:#e8e8ec;--node-external-border:#999;--node-external-text:#333;
  --node-concern-bg:#fce4ec;--node-concern-border:#e57373;--node-concern-text:#b71c1c;
  --node-entry-bg:#e3f2fd;--node-entry-border:#64b5f6;--node-entry-text:#0d47a1;
  --node-store-bg:#e8f5e9;--node-store-border:#81c784;--node-store-text:#1b5e20;
  --node-default-bg:#fff;--node-default-border:#bbb;--node-default-text:#333;
  --svg-group-fill:#f8f8f8;--svg-group-stroke:#bbb;
  --svg-edge-0:#94a3b8;--svg-edge-label-bg:#e8e8e8;--svg-edge-label-text:#475569;
}
html,body{height:100%;overflow:hidden}
body{font-family:var(--sans);background:var(--bg);color:var(--text);display:flex;flex-direction:column}
h1{font-family:var(--serif);font-weight:500;font-size:22px;letter-spacing:-0.01em}
.sub{font-family:var(--mono);font-size:11px;color:var(--text-muted);letter-spacing:0.06em;text-transform:uppercase}

.bar{display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--border-subtle);flex-shrink:0}
.bar .spacer{flex:1}

.flow-bar{display:flex;align-items:center;gap:6px;padding:8px 16px;border-bottom:1px solid var(--border-muted);flex-wrap:wrap;flex-shrink:0}
.flow-bar-label{font-family:var(--mono);font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);margin-right:4px}
.flow-chip{font-family:var(--mono);font-size:11px;letter-spacing:0.04em;padding:4px 10px;border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--text-muted);cursor:pointer;transition:all .15s ease}
.flow-chip:hover{color:var(--text);border-color:var(--text-faint)}
.flow-chip.active{background:var(--text);border-color:var(--text);color:var(--bg)}

.stage{flex:1;position:relative;overflow:hidden;cursor:grab;background-color:var(--bg);background-image:radial-gradient(circle,var(--text-ghost) 1px,transparent 1px);background-size:28px 28px}
.stage svg{position:absolute;inset:0;width:100%;height:100%;display:block}

.node{cursor:pointer}
.node rect{fill:var(--node-default-bg);stroke:var(--node-default-border);stroke-width:1.5;rx:10;transition:stroke .15s,filter .15s}
.node:hover rect{stroke:var(--text-mid)}
.node .t{font-family:var(--sans);font-size:14px;font-weight:600;fill:var(--node-default-text);pointer-events:none}
.node .m{font-family:var(--mono);font-size:11px;fill:var(--text-muted);pointer-events:none}
.node.ext rect{fill:var(--node-external-bg);stroke:var(--node-external-border);stroke-dasharray:6 3}
.node.ext .t{fill:var(--node-external-text)}
.node.concern rect{fill:var(--node-concern-bg);stroke:var(--node-concern-border)}
.node.concern .t{fill:var(--node-concern-text)}
.node.entry rect{fill:var(--node-entry-bg);stroke:var(--node-entry-border)}
.node.entry .t{fill:var(--node-entry-text)}
.node.store rect{fill:var(--node-store-bg);stroke:var(--node-store-border)}
.node.store .t{fill:var(--node-store-text)}

.edge{stroke:var(--svg-edge-0);stroke-width:1.6;fill:none}
.elbl{font-family:var(--mono);font-size:10px;fill:var(--svg-edge-label-text)}

/* Flow animation */
.stage.flowing .edge{stroke-opacity:0.2;stroke-width:1px;transition:all .2s}
.stage.flowing .elbl{opacity:0.2;transition:opacity .2s}
.stage.flowing .node rect{fill-opacity:0.15;stroke-opacity:0.3;transition:all .2s}
.stage.flowing .edge.flow-lit{stroke:var(--accent)!important;stroke-width:3px;stroke-opacity:1!important;stroke-dasharray:8 5;animation:march 0.8s linear infinite}
.stage.flowing .elbl.flow-lit{opacity:1!important}
.stage.flowing .node.flow-lit rect{fill-opacity:1!important;stroke-opacity:1!important;stroke:var(--accent)!important;stroke-width:3px;filter:drop-shadow(0 0 8px var(--accent-glow))}
@keyframes march{to{stroke-dashoffset:-12}}
@media(prefers-reduced-motion:reduce){.stage.flowing .edge.flow-lit{animation:none}}

/* Detail card */
.card{position:absolute;max-width:360px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;box-shadow:0 6px 24px rgba(0,0,0,0.08);display:none;z-index:100}
.card.show{display:block}
.card h3{font-family:var(--serif);font-weight:500;font-size:17px;color:var(--text);margin-bottom:8px}
.card .field{margin-bottom:10px}
.card .field-title{font-family:var(--mono);font-size:9px;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:4px}
.card .field-body{font-size:13px;line-height:1.6;color:var(--text-body)}
.card .field-body code{font-family:var(--mono);font-size:12px;background:var(--surface3);padding:1px 4px;border-radius:3px}
.card .close-btn{position:absolute;top:8px;right:10px;background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:18px;line-height:1;padding:0}

#themeToggle{font-family:var(--mono);font-size:10.5px;text-transform:uppercase;letter-spacing:0.08em;padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-muted);cursor:pointer}
#themeToggle:hover{color:var(--text);border-color:var(--text-muted)}
</style>
</head>
<body>
<div class="bar">
  <div>
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(element)} · ${data.meta?.children?.length || 0} children</div>
  </div>
  <div class="spacer"></div>
  <button id="themeToggle">Theme</button>
</div>
${flows.length > 0 ? `<div class="flow-bar">
  <span class="flow-bar-label">Flows</span>
  ${flows.map((f, i) => `<button class="flow-chip" data-flow="${i}">${esc(f.name)}</button>`).join('\n  ')}
</div>` : ''}
<div class="stage" id="stage">
  <svg id="svg"></svg>
  <div class="card" id="card">
    <button class="close-btn" onclick="closeCard()">×</button>
    <div id="card-content"></div>
  </div>
</div>
<script>
// ── data ──
var DIAGRAM_B64 = "${Buffer.from(data.diagram || '', 'utf-8').toString('base64')}";
var DIAGRAM = atob(DIAGRAM_B64);
var FLOWS = ${safeJson(flows)};
var NODE_DETAILS = ${safeJson(nodeDetails)};
var CHILDREN_DIAGRAMS = ${safeJson(Object.fromEntries(Object.entries(children).filter(([,v]) => v.diagram).map(([k,v]) => [k, v.diagram!])))};

// ── helpers ──
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ── theme ──
function toggleTheme(){
  var html=document.documentElement;
  var isLight=html.classList.toggle('light');
  try{localStorage.setItem('omm-theme',isLight?'light':'dark')}catch(e){}
  document.getElementById('themeToggle').textContent=isLight?'Dark':'Light';
}
(function(){
  var isLight=document.documentElement.classList.contains('light');
  document.getElementById('themeToggle').textContent=isLight?'Dark':'Light';
})();
document.getElementById('themeToggle').onclick=toggleTheme;

// ── parser (from omm viewer) ──
function parseFlowchart(raw){
  // Fix: replace actual newlines INSIDE quoted labels with <br> before splitting
  // Process character by character to track quote state
  var NL=String.fromCharCode(10);
  var fixed='';var inQuote=false;
  for(var i=0;i<raw.length;i++){
    var ch=raw[i];
    if(ch==='"')inQuote=!inQuote;
    if(ch===NL&&inQuote){fixed+='<br>';continue}
    fixed+=ch;
  }
  var lines=fixed.split(NL).map(function(l){return l.trim()}).filter(function(l){return l&&!l.startsWith('%%')});
  var rankdir='LR';var nodesMap=new Map();var edges=[];var classOf={};
  function cleanLabel(s){return s.replace(/<br\\s*\\/?>/gi,NL)}
  function refFromLabel(label){var m=label.match(/^@([\\w-]+)/);return m?m[1]:null}
  function tok(t){
    t=t.trim();var m;
    m=t.match(/^(@?[\\w-]+)\\["([^"]+)"\\]$/);if(m){var lbl=cleanLabel(m[2]),r=refFromLabel(lbl),idR=m[1].startsWith('@');return{id:m[1].replace(/^@/,''),label:lbl,shape:'rect',isRef:idR||!!r,refTarget:r||(idR?m[1].replace(/^@/,''):null)}}
    m=t.match(/^(@?[\\w-]+)\\[([^\\]]+)\\]$/);if(m){var lbl=cleanLabel(m[2]),r=refFromLabel(lbl),idR=m[1].startsWith('@');return{id:m[1].replace(/^@/,''),label:lbl,shape:'rect',isRef:idR||!!r,refTarget:r||(idR?m[1].replace(/^@/,''):null)}}
    m=t.match(/^(@?[\\w-]+)\\(\\(([^)]+)\\)\\)$/);if(m){var lbl=cleanLabel(m[2]),r=refFromLabel(lbl);return{id:m[1].replace(/^@/,''),label:lbl,shape:'stadium',isRef:m[1].startsWith('@')||!!r,refTarget:r}}
    m=t.match(/^(@?[\\w-]+)\\(([^)]+)\\)$/);if(m){var lbl=cleanLabel(m[2]),r=refFromLabel(lbl);return{id:m[1].replace(/^@/,''),label:lbl,shape:'round',isRef:m[1].startsWith('@')||!!r,refTarget:r}}
    m=t.match(/^(@?[\\w-]+)\\{([^}]+)\\}$/);if(m){var lbl=cleanLabel(m[2]),r=refFromLabel(lbl);return{id:m[1].replace(/^@/,''),label:lbl,shape:'diamond',isRef:m[1].startsWith('@')||!!r,refTarget:r}}
    if(/^@?[\\w-]+$/.test(t)){var id=t.replace(/^@/,'');return{id,label:id,shape:'rect',isRef:t.startsWith('@')}}
    return null
  }
  var edgeLineRe=/^(.+?)\\s+--\\s+"([^"]+)"\\s+-->\\s+(.+)$/;
  var arrowRe=/(-->(?:\\|[^|]*\\|)?|--o|--x|---|-.->|==>|~~>)/;
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
    var dir=line.match(/^(?:graph|flowchart)\\s+([A-Z]{2})/i);
    if(dir){var d=dir[1].toUpperCase();rankdir=(d==='TD'||d==='TB')?'TB':d;continue}
    if(/^(classDef|click |style |linkStyle|subgraph|end$)/i.test(line))continue;
    var ca=line.match(/^class\\s+([\\w\\-,\\s]+)\\s+(\\w+)$/);
    if(ca){ca[1].split(',').map(function(s){return s.trim()}).forEach(function(id){classOf[id]=ca[2]});continue}
    var labelEdge=line.match(edgeLineRe);
    if(labelEdge){var src=tok(labelEdge[1]),dst=tok(labelEdge[3]);if(src&&dst){if(!nodesMap.has(src.id))nodesMap.set(src.id,src);if(!nodesMap.has(dst.id))nodesMap.set(dst.id,dst);edges.push({from:src.id,to:dst.id,label:labelEdge[2].replace(/<br\\s*\\/?>/gi,' ')})}continue}
    var parts=line.split(arrowRe);
    if(parts.length>=3){var src=tok(parts[0]),dst=tok(parts[2]);if(src&&dst){if(!nodesMap.has(src.id))nodesMap.set(src.id,src);if(!nodesMap.has(dst.id))nodesMap.set(dst.id,dst);var lm=parts[1].match(/\\|([^|]+)\\|/);edges.push({from:src.id,to:dst.id,label:lm?lm[1].replace(/<br\\s*\\/?>/gi,' '):''})}}
    else{var n=tok(line);if(n&&!nodesMap.has(n.id))nodesMap.set(n.id,n)}
  }
  for(var k in classOf){var n=nodesMap.get(k);if(n)n.cls=classOf[k]}
  return{rankdir:rankdir,nodes:Array.from(nodesMap.values()),edges:edges}
}

// ── layout + render ──
function cv(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim()}
function nodeStyle(node){
  var c=node.cls||'';
  if(c==='external')return{bg:cv('--node-external-bg'),border:cv('--node-external-border'),text:cv('--node-external-text')}
  if(c==='concern')return{bg:cv('--node-concern-bg'),border:cv('--node-concern-border'),text:cv('--node-concern-text')}
  if(c==='entry')return{bg:cv('--node-entry-bg'),border:cv('--node-entry-border'),text:cv('--node-entry-text')}
  if(c==='store')return{bg:cv('--node-store-bg'),border:cv('--node-store-border'),text:cv('--node-store-text')}
  return{bg:cv('--node-default-bg'),border:cv('--node-default-border'),text:cv('--node-default-text')}
}

function smoothPath(pts){
  if(pts.length<2)return'';
  var d='M'+pts[0].x+','+pts[0].y;
  if(pts.length===2){d+=' L'+pts[1].x+','+pts[1].y;return d}
  for(var i=1;i<pts.length-1;i++){
    var p0=pts[i-1],p1=pts[i],p2=pts[i+1];
    var cx=(p0.x+p1.x)/2,cy=(p0.y+p1.y)/2;
    var cx2=(p1.x+p2.x)/2,cy2=(p1.y+p2.y)/2;
    if(i===1)d+=' L'+cx+','+cy;
    d+=' Q'+p1.x+','+p1.y+' '+cx2+','+cy2;
  }
  d+=' L'+pts[pts.length-1].x+','+pts[pts.length-1].y;
  return d
}

function tw(text,font){
  var c=document.createElement('canvas').getContext('2d');
  c.font=font||'11px Inter,system-ui';
  return Math.ceil(c.measureText(text).width);
}
function fmtLabel(s){return s.split('-').map(function(w){return w.charAt(0).toUpperCase()+w.slice(1)}).join(' ')}
function r1(n){return +n.toFixed(1)}

function renderDiagram(){
  var parsed=parseFlowchart(DIAGRAM);
  var rankdir=parsed.rankdir,nodes=parsed.nodes,edges=parsed.edges;
  if(!nodes.length)return;

  var PAD_L=24,PAD_R=50,PAD_T=24,PAD_B=40;
  var nodeDims={};

  nodes.forEach(function(n){
    var lbl=n.label.replace(/^@/,'');
    var parts=lbl.split('\\n');
    var mainLbl=parts[0];var pathLbl=parts[1]||'';
    var hasPath=lbl.includes('\\n');
    var maxW=nodes.length>10?200:260;
    var mainW=tw(mainLbl,'12px Inter,system-ui')+44;
    var pathW=pathLbl?tw(pathLbl,'9px SF Mono,Fira Code,monospace')+32:0;
    var w=Math.min(maxW,Math.max(90,Math.max(mainW,pathW)));
    var baseH=n.shape==='diamond'?42:38;
    nodeDims[n.id]={width:w,height:hasPath?baseH+20:baseH};
  });

  var g=new dagre.graphlib.Graph();
  g.setGraph({rankdir:rankdir,nodesep:48,ranksep:64,marginx:40,marginy:40});
  g.setDefaultEdgeLabel(function(){return{}});
  nodes.forEach(function(n){
    var d=nodeDims[n.id];
    g.setNode(n.id,{width:d.width,height:d.height});
  });
  edges.forEach(function(e){if(g.hasNode(e.from)&&g.hasNode(e.to))g.setEdge(e.from,e.to)});
  try{dagre.layout(g)}catch(e){return}

  var gi=g.graph();
  var W=r1(gi.width+PAD_R),H=r1(gi.height+PAD_B);
  var svgContent='';var edgeLabels='';

  var ec=cv('--svg-edge-0')||'#909090';
  var elbg=cv('--svg-edge-label-bg')||'#000';
  var eltx=cv('--svg-edge-label-text')||'#aaa';

  edges.forEach(function(e,i){
    var ed=g.edge(e.from,e.to);if(!ed||!ed.points||!ed.points.length)return;
    var pts=ed.points,d=smoothPath(pts),mid=pts[Math.floor(pts.length/2)];
    var mk='m'+i;
    svgContent+='<defs><marker id="'+mk+'" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0.5 L0,4.5 L6,2.5 z" fill="'+ec+'"/></marker></defs>';
    svgContent+='<path class="edge" d="'+d+'" stroke="'+ec+'" stroke-width="2" fill="none" marker-end="url(#'+mk+')" data-from="'+esc(e.from)+'" data-to="'+esc(e.to)+'"/>';
    if(e.label){
      var lw=tw(e.label,'10px Inter')+12;
      var mx=r1(mid.x),my=r1(mid.y);
      edgeLabels+='<g class="elbl" data-from="'+esc(e.from)+'" data-to="'+esc(e.to)+'"><rect x="'+(mx-lw/2)+'" y="'+(my-8)+'" width="'+lw+'" height="16" rx="3" fill="'+elbg+'"/><text x="'+mx+'" y="'+(my+4)+'" text-anchor="middle" font-family="Inter,system-ui" font-size="10" fill="'+eltx+'">'+esc(e.label)+'</text></g>';
    }
  });

  nodes.forEach(function(n){
    var pos=g.node(n.id);if(!pos)return;
    var dim=nodeDims[n.id];
    var nx=r1(pos.x-dim.width/2),ny=r1(pos.y-dim.height/2);
    var st=nodeStyle(n);
    var rawLbl=n.label.replace(/^@/,'');
    var lblParts=rawLbl.split('\\n');
    var mainLbl=lblParts[0],pathLbl=lblParts[1];
    var cx=r1(pos.x),cy=r1(pos.y);
    var shape='';
    if(n.shape==='diamond'){
      shape='<polygon points="'+cx+','+ny+' '+(nx+dim.width)+','+cy+' '+cx+','+(ny+dim.height)+' '+nx+','+cy+'" fill="'+st.bg+'" stroke="'+st.border+'" stroke-width="2"/>';
    }else if(n.shape==='stadium'||n.shape==='round'){
      shape='<rect x="'+nx+'" y="'+ny+'" width="'+dim.width+'" height="'+dim.height+'" rx="'+(dim.height/2)+'" fill="'+st.bg+'" stroke="'+st.border+'" stroke-width="2"/>';
    }else{
      shape='<rect x="'+nx+'" y="'+ny+'" width="'+dim.width+'" height="'+dim.height+'" rx="4" fill="'+st.bg+'" stroke="'+st.border+'" stroke-width="2"/>';
    }
    var clsAttr='node'+((n.cls==='external')?' ext':(n.cls==='concern')?' concern':(n.cls==='entry')?' entry':(n.cls==='store')?' store':'');
    svgContent+='<g class="'+clsAttr+'" data-id="'+esc(n.id)+'">';
    svgContent+=shape;
    if(pathLbl){
      svgContent+='<text class="t" x="'+cx+'" y="'+(r1(cy-7))+'" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-size="12" fill="'+st.text+'">'+esc(mainLbl)+'</text>';
      svgContent+='<text class="m" x="'+cx+'" y="'+(r1(cy+7))+'" text-anchor="middle" dominant-baseline="central" font-family="SF Mono,Fira Code,monospace" font-size="9" fill="'+st.text+'" opacity="0.45">'+esc(pathLbl)+'</text>';
    }else{
      svgContent+='<text class="t" x="'+cx+'" y="'+cy+'" text-anchor="middle" dominant-baseline="central" font-family="Inter,system-ui,sans-serif" font-size="12" fill="'+st.text+'">'+esc(mainLbl)+'</text>';
    }
    svgContent+='</g>';
  });

  svgContent+=edgeLabels;

  var vb='0 0 '+W+' '+H;
  var svg=document.getElementById('svg');
  svg.setAttribute('viewBox',vb);
  svg.innerHTML=svgContent;

  // Fit to stage
  var stage=document.getElementById('stage');
  var sw=stage.clientWidth,sh=stage.clientHeight;
  var scale=Math.min(sw/W,sh/H)*0.9;
  var tx=(sw-W*scale)/2,ty=(sh-H*scale)/2;
  svg.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';
  svg.style.transformOrigin='0 0';
}

// ── flow chips ──
var activeFlow=-1;
function toggleFlow(idx){
  var svg=document.getElementById('svg');
  var stage=document.getElementById('stage');
  if(activeFlow===idx){deactivateFlow();return}
  activeFlow=idx;
  var flow=FLOWS[idx];if(!flow)return;
  stage.classList.add('flowing');

  var litNodes=new Set();var litEdges=new Set();
  flow.steps.forEach(function(s){
    if(s.node)litNodes.add(s.node);
    if(s.edge){var p=s.edge.split('->');if(p[0]&&p[1])litEdges.add(p[0]+'->'+p[1])}
  });

  svg.querySelectorAll('.node').forEach(function(el){
    var id=el.getAttribute('data-id');
    if(litNodes.has(id))el.classList.add('flow-lit');else el.classList.remove('flow-lit');
  });
  svg.querySelectorAll('.edge').forEach(function(el){
    var from=el.getAttribute('data-from'),to=el.getAttribute('data-to');
    if(litEdges.has(from+'->'+to))el.classList.add('flow-lit');else el.classList.remove('flow-lit');
  });
  svg.querySelectorAll('.elbl').forEach(function(el){
    var from=el.getAttribute('data-from'),to=el.getAttribute('data-to');
    if(litEdges.has(from+'->'+to))el.classList.add('flow-lit');else el.classList.remove('flow-lit');
  });

  document.querySelectorAll('.flow-chip').forEach(function(c,i){
    c.classList.toggle('active',i===idx);
  });
}
function deactivateFlow(){
  activeFlow=-1;
  var stage=document.getElementById('stage');
  stage.classList.remove('flowing');
  document.querySelectorAll('.flow-lit').forEach(function(el){el.classList.remove('flow-lit')});
  document.querySelectorAll('.flow-chip').forEach(function(c){c.classList.remove('active')});
}
document.querySelectorAll('.flow-chip').forEach(function(chip){
  chip.addEventListener('click',function(){toggleFlow(parseInt(chip.getAttribute('data-flow')))})
});

// ── node click → detail card ──
function showCard(nodeId,x,y){
  var details=NODE_DETAILS[nodeId];if(!details)return;
  var html='<h3>'+esc(fmtLabel(nodeId))+'</h3>';
  if(details.description)html+='<div class="field"><div class="field-title">Description</div><div class="field-body">'+esc(details.description)+'</div></div>';
  if(details.context)html+='<div class="field"><div class="field-title">Context</div><div class="field-body">'+esc(details.context)+'</div></div>';
  if(details.concern)html+='<div class="field"><div class="field-title">Concern</div><div class="field-body">'+esc(details.concern)+'</div></div>';
  if(details.constraint)html+='<div class="field"><div class="field-title">Constraint</div><div class="field-body">'+esc(details.constraint)+'</div></div>';
  if(CHILDREN_DIAGRAMS[nodeId])html+='<div class="field"><div class="field-title">Has children</div><div class="field-body">This element has nested sub-diagrams.</div></div>';
  var card=document.getElementById('card');
  document.getElementById('card-content').innerHTML=html;
  card.style.left=Math.min(x,window.innerWidth-380)+'px';
  card.style.top=Math.min(y,window.innerHeight-300)+'px';
  card.classList.add('show');
}
function closeCard(){document.getElementById('card').classList.remove('show')}

document.getElementById('svg').addEventListener('click',function(e){
  var node=e.target.closest('.node');
  if(node){
    e.stopPropagation();
    var nodeId=node.getAttribute('data-id');
    showCard(nodeId,e.clientX,e.clientY);
  }else{
    closeCard();
  }
});

// ── init ──
renderDiagram();
window.addEventListener('resize',renderDiagram);
</script>
</body>
</html>`;
}
