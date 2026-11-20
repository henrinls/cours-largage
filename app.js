// Cours de largage — simulation animée d'un largage, pour illustrer le cours du brevet C (et du BPA).
// Vue de profil : l'avion en haut, le sol en bas ; trajectoires gardées en pointillés, points numérotés à intervalle
// régulier (même numéro = même instant) ; deux paras qui se suivent à moins de l'écart voulu (300 m) → en rouge.
'use strict';
const VERSION = '0.3.1';
const G = 9.81, KT = 0.514444;
const $ = id => document.getElementById(id);

// ---------- Réglages ----------
const DEF = {
  speed: 70, height: 4000, sep: null /* null = auto */, dir: 'R' /* le vent va vers la gauche : vers la droite = face au vent */, gap: 300, dot: 5, play: 5,
  vz: 4, vzMon: 8, openLoss: 100,
  types: {
    vertical: { vt: 75, d10: 450, hOpen: 1000 },
    plat: { vt: 50, d10: 300, hOpen: 1000 },
    eleve: { vt: 50, d10: 300, hOpen: 1500 }
  },
  paras: [{ type: 'plat', mon: false }, { type: 'plat', mon: false }, { type: 'eleve', mon: false }],
  winds: [
    { name: 'Vent nul', w: [0, 0, 0, 0] },
    { name: 'Vent régulier 5 m/s', w: [5, 5, 5, 5] },
    { name: 'Vent fort en altitude', w: [3, 8, 12, 16] },
    { name: 'Très fort en altitude, calme au sol', w: [1, 6, 15, 22] }
  ],
  windIdx: 0
};
const TYPE_NAMES = { vertical: 'Vertical', plat: 'À plat', eleve: 'Élève' };
const TYPE_LETTER = { vertical: 'V', plat: 'P', eleve: 'É' };
const NEXT_TYPE = { vertical: 'plat', plat: 'eleve', eleve: 'vertical' };
const COLORS = ['#4fc3f7', '#ffd54f', '#81c784', '#ff8a65', '#ba68c8', '#4db6ac', '#f06292', '#aed581', '#90caf9', '#ffb74d', '#ce93d8', '#80deea'];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const clone = o => JSON.parse(JSON.stringify(o));
let S = Object.assign(clone(DEF), store.get('cl.state', {}));
S.types = Object.assign(clone(DEF.types), S.types || {});
if (!Array.isArray(S.winds) || !S.winds.length) S.winds = clone(DEF.winds);
if (!(S.windIdx >= 0 && S.windIdx < S.winds.length)) S.windIdx = 0;
if (!Array.isArray(S.paras)) S.paras = clone(DEF.paras);
{ const old = store.get('cl.state', null); if (old && old.dir && !old.dirFix) S.dir = old.dir === 'R' ? 'L' : 'R'; S.dirFix = true; } // v0.2.2 : libellés face au vent / vent dans le dos étaient inversés
function save() { store.set('cl.state', S); }

const num = v => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : NaN; };
const fmt1 = v => (Math.round(v * 10) / 10).toString().replace('.', ',');
const fmtInt = v => Math.round(v).toLocaleString('fr-FR');
// Auto : temps entre sorties pour avoir l'écart voulu AU SOL au moment de sortir, avec le vent à la hauteur de largage
// (vitesse sol de l'avion = vitesse propre ± vent de la tranche du haut) ; plafonné à 60 s si le vent de face est énorme
const groundSpeed = () => Math.abs((S.dir === 'R' ? 1 : -1) * (+S.speed || 70) * KT + windAt((+S.height || 4000) - 1));
const autoSep = () => Math.min(60, Math.ceil((+S.gap || 300) / Math.max(1, groundSpeed()) - 1e-9));
const sepNow = () => (S.sep == null || !(S.sep > 0)) ? autoSep() : +S.sep;

// ---------- Physique ----------
// Chute : v(τ) = vt·tanh(τ/T), hauteur perdue = vt·T·ln cosh(τ/T) ; T est réglé pour perdre d10 mètres les 10 premières secondes
function calibT(vt, d10) {
  const lost = T => vt * T * Math.log(Math.cosh(10 / T));
  let a = 0.3, b = 60; // lost() décroît quand T augmente : on cherche T tel que lost(T) = d10
  if (d10 >= lost(a)) return a; if (d10 <= lost(b)) return b;
  for (let i = 0; i < 60; i++) { const m = (a + b) / 2; if (lost(m) > d10) a = m; else b = m; }
  return (a + b) / 2;
}
// Vent (vitesse horizontale de l'air, m/s, positive vers la droite) : il vient de la droite → valeur négative
function windAt(z) {
  const W = S.winds[S.windIdx].w, H = +S.height || 4000;
  const i = Math.max(0, Math.min(3, Math.floor(z / (H / 4))));
  return -(+W[i] || 0);
}
let SIM = null;
function simulate() {
  const H = +S.height || 4000, Va = (+S.speed || 70) * KT, dir = S.dir === 'R' ? 1 : -1, sep = sepNow();
  const vpg = dir * Va + windAt(H - 1); // vitesse sol de l'avion à la hauteur de largage
  const dt = 0.05, L = Math.max(1, +S.openLoss || 100);
  const paras = S.paras.map((p, i) => {
    const ty = S.types[p.type] || S.types.plat, vt = Math.max(5, +ty.vt || 50), T = calibT(vt, Math.max(1, +ty.d10 || 300));
    const hOpen = Math.min(H - 10, Math.max(50, +ty.hOpen || 1000)), vzC = p.mon && p.type !== 'eleve' ? (+S.vzMon || 8) : (+S.vz || 4);
    const te = i * sep, k = G / (vt * vt);
    let t = 0, x = vpg * te, z = H, u = dir * Va, phase = 'ff', tO = 0, vOpen = 0, tp = 0, tOpenStart = null, tOpenEnd = null;
    const track = [{ t: te, x, z, ph: 'ff' }];
    for (let n = 0; n < 200000 && z > 0; n++) {
      let vzNow;
      if (phase === 'ff') {
        const zNext = H - vt * T * Math.log(Math.cosh((t + dt) / T));
        vzNow = vt * Math.tanh((t + dt / 2) / T);
        u += -k * Math.hypot(u, vzNow) * u * dt;
        z = zNext;
        if (z <= hOpen) { z = hOpen; phase = 'open'; vOpen = vt * Math.tanh((t + dt) / T); tO = 2 * L / (vOpen + vzC); tp = 0; tOpenStart = te + t + dt; }
      } else if (phase === 'open') {
        tp += dt; const f = Math.min(1, tp / tO);
        vzNow = vOpen + (vzC - vOpen) * f; z -= vzNow * dt; u *= Math.max(0, 1 - f);
        if (f >= 1) { phase = 'canopy'; u = 0; tOpenEnd = te + t + dt; }
      } else { vzNow = vzC; z -= vzC * dt; u = 0; }
      x += (u + windAt(z)) * dt; t += dt;
      if (n % 5 === 4 || z <= 0) track.push({ t: te + t, x, z: Math.max(0, z), ph: phase }); // un point toutes les 0,25 s
    }
    return { i, type: p.type, mon: !!p.mon && p.type !== 'eleve', te, track, tOpenStart, tOpenEnd, color: COLORS[i % COLORS.length], hOpen };
  });
  // Fin = ouverture du dernier para (Henri : le dernier point est le point d'ouverture du dernier para)
  const tEnd = paras.length ? Math.max(...paras.map(p => p.tOpenStart != null ? p.tOpenStart : p.te)) : 10;
  // Positions aux instants 1×, 2×, … l'intervalle des points (même numéro = même instant), plus un dernier point à la fin
  const dot = Math.max(1, +S.dot || 5), samples = [];
  for (let k = 1; k * dot < tEnd - 0.5; k++) samples.push({ k, t: k * dot, lab: String(k), pos: paras.map(p => posAt(p, k * dot)) });
  if (paras.length) samples.push({ k: samples.length + 1, t: tEnd, lab: 'fin', last: true, pos: paras.map(p => posAt(p, tEnd)) });
  // Écart HORIZONTAL entre paras qui se suivent, à chaque point ; compté seulement quand le second est sorti depuis plus de 10 s
  // (avant, la projection du second rapproche toujours les paras, même pour un largage parfait)
  const gap = +S.gap || 300, close = [];
  samples.forEach(s => {
    s.pairs = [];
    for (let i = 0; i + 1 < paras.length; i++) {
      const a = s.pos[i], b = s.pos[i + 1];
      if (!a || !b || s.t - paras[i + 1].te <= 10) continue;
      const pr = { k: s.k, t: s.t, i, a, b, d: Math.abs(a.x - b.x) };
      pr.red = pr.d < gap; s.pairs.push(pr); if (pr.red) close.push(pr);
    }
  });
  SIM = { H, Va, dir, sep, vpg, paras, tEnd, samples, close, lastExit: paras.length ? paras[paras.length - 1].te : 0 };
  bounds();
}
function posAt(p, t) { // position (x, z) du para à l'instant t, null s'il n'est pas encore sorti
  if (t < p.te) return null;
  const tr = p.track; if (t >= tr[tr.length - 1].t) return tr[tr.length - 1];
  let a = 0, b = tr.length - 1;
  while (b - a > 1) { const m = (a + b) >> 1; if (tr[m].t <= t) a = m; else b = m; }
  const A = tr[a], B = tr[b], f = (t - A.t) / Math.max(1e-9, B.t - A.t);
  return { t, x: A.x + (B.x - A.x) * f, z: A.z + (B.z - A.z) * f, ph: f < 1 ? A.ph : B.ph };
}
const planeX = t => SIM.vpg * t;

// ---------- Dessin ----------
const cv = $('cv'), g = cv.getContext('2d');
let W = 0, Hpx = 0, DPR = 1, view = null;
function resize() {
  DPR = Math.min(3, window.devicePixelRatio || 1); W = innerWidth; Hpx = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(Hpx * DPR); g.setTransform(DPR, 0, 0, DPR, 0, 0);
  bounds(); draw();
}
function bounds() {
  if (!SIM) return;
  let x0 = Infinity, x1 = -Infinity;
  const tPlane1 = SIM.lastExit + 6;
  SIM.paras.forEach(p => p.track.forEach(q => { if (q.t <= SIM.tEnd) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); } }));
  [-4, tPlane1].forEach(t => { const x = planeX(t); x0 = Math.min(x0, x); x1 = Math.max(x1, x); });
  if (!isFinite(x0)) { x0 = -500; x1 = 500; }
  const span = Math.max(400, x1 - x0), pad = span * 0.04; x0 -= pad; x1 += pad;
  const top = $('top').getBoundingClientRect().bottom + 34, bot = $('scrub').getBoundingClientRect().top - 22, left = 50, right = W - 14;
  // bas de la vue : un peu sous l'ouverture la plus basse (l'animation s'arrête quand le dernier a ouvert : pas besoin du sol)
  let zMin = Infinity; SIM.paras.forEach(p => p.track.forEach(q => { if (q.t <= SIM.tEnd) zMin = Math.min(zMin, q.z); }));
  const z0 = Math.max(0, Math.floor(((isFinite(zMin) ? zMin : 0) - 200) / 250) * 250);
  view = { x0, x1, left, right, top, bot, z0, sx: (right - left) / (x1 - x0), sy: (bot - top) / (SIM.H - z0) };
}
const X = x => view.left + (x - view.x0) * view.sx;
const Y = z => view.bot - (z - view.z0) * view.sy;

let tNow = 0;
function draw() {
  g.clearRect(0, 0, W, Hpx);
  g.fillStyle = '#141414'; g.fillRect(0, 0, W, Hpx);
  if (!SIM || !view) return;
  const H = SIM.H;
  // Graduations de hauteur
  g.font = '11px -apple-system, Helvetica, Arial, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
  for (let z = Math.ceil(view.z0 / 500) * 500; z <= H + 1; z += 500) {
    const y = Y(z); g.strokeStyle = z % 1000 === 0 ? '#2e2e2e' : '#222'; g.lineWidth = 1; g.beginPath(); g.moveTo(view.left, y); g.lineTo(view.right, y); g.stroke();
    if (z % 1000 === 0) { g.fillStyle = '#888'; g.fillText(`${fmtInt(z)} m`, view.left - 6, y); }
  }
  // Hauteurs d'ouverture
  const hos = [...new Set(SIM.paras.map(p => p.hOpen))];
  hos.forEach(h => { const y = Y(h); g.setLineDash([3, 5]); g.strokeStyle = '#5a4a2a'; g.beginPath(); g.moveTo(view.left, y); g.lineTo(view.right, y); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#a8894f'; g.textAlign = 'left'; g.fillText(`ouverture ${fmtInt(h)} m`, view.left + 4, y - 8); g.textAlign = 'right'; });
  // Sol (s'il est dans la vue)
  if (view.z0 <= 0) { g.strokeStyle = '#6a8a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(view.left, Y(0)); g.lineTo(view.right, Y(0)); g.stroke(); }
  // Vent par tranche (flèches à droite)
  const Wv = S.winds[S.windIdx].w;
  g.textAlign = 'right'; g.font = '11px -apple-system, Helvetica, Arial, sans-serif';
  for (let i = 0; i < 4; i++) { const zc = Math.max(view.z0 + 120, (i + 0.5) * H / 4), w = +Wv[i] || 0; if (!w || (i + 1) * H / 4 <= view.z0) continue;
    g.fillStyle = '#6fa8dc'; g.fillText(`← ${fmt1(w)} m/s`, view.right - 2, Y(zc)); }
  // Trajectoire de l'avion et avion
  const tP1 = Math.min(tNow, SIM.lastExit + 6);
  g.strokeStyle = '#555'; g.lineWidth = 1; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(X(planeX(-4)), Y(H)); g.lineTo(X(planeX(tP1)), Y(H)); g.stroke(); g.setLineDash([]);
  if (tNow <= SIM.lastExit + 6) drawPlane(X(planeX(tNow)), Y(H), SIM.dir);
  // Trajectoires des paras (pointillés) jusqu'à maintenant
  SIM.paras.forEach(p => {
    if (tNow < p.te) return;
    g.strokeStyle = p.color; g.lineWidth = 1.6; g.setLineDash([4, 4]); g.beginPath();
    let first = true;
    for (const q of p.track) { if (q.t > tNow) break; const x = X(q.x), y = Y(q.z); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    const c = posAt(p, tNow); if (c) g.lineTo(X(c.x), Y(c.z));
    g.stroke(); g.setLineDash([]);
  });
  // Écarts horizontaux entre paras qui se suivent : en rouge (moins de l'écart voulu) seule la plus petite est écrite ; en gris
  // (écart suffisant) seulement ceux du dernier point atteint, effacés au point suivant ; à la fin, ceux de l'ouverture du dernier
  const redSet = new Set();
  let cur = null; SIM.samples.forEach(s => { if (s.t <= tNow + 1e-6) cur = s; });
  // Rouge : tous les points trop proches restent en rouge, mais UNE seule distance rouge écrite, la plus petite (sinon illisible)
  let minC = null;
  SIM.close.forEach(c => { if (c.t > tNow + 1e-6) return; redSet.add(c.k + ':' + c.i); redSet.add(c.k + ':' + (c.i + 1)); if (!minC || c.d < minC.d) minC = c; });
  if (minC) hMeasure(minC, '#ff5a5a');
  if (cur) cur.pairs.forEach(c => { if (!c.red) hMeasure(c, '#c8c8c8'); });
  // Points numérotés (même numéro = même instant)
  SIM.samples.forEach(s => {
    if (s.t > tNow + 1e-6) return;
    s.pos.forEach((q, i) => {
      if (!q) return;
      const red = redSet.has(s.k + ':' + i), x = X(q.x), y = Y(q.z);
      g.beginPath(); g.arc(x, y, red ? 3.6 : 2.6, 0, Math.PI * 2); g.fillStyle = red ? '#ff3b3b' : SIM.paras[i].color; g.fill();
      g.lineWidth = 1; g.strokeStyle = '#000'; g.stroke();
      g.font = '10px -apple-system, Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      outlined(s.lab, x + 5, y, red ? '#ff6b6b' : '#ddd');
    });
  });
  // Paras à leur position actuelle
  SIM.paras.forEach(p => {
    const c = posAt(p, tNow); if (!c) return;
    drawPara(X(c.x), Y(c.z), p, c.ph);
  });
  // Échelle
  const ratio = view.sy > 0 ? view.sx / view.sy : 1;
  const bar = [100, 200, 500, 1000, 2000].find(v => v * view.sx > 60) || 2000;
  g.strokeStyle = '#aaa'; g.lineWidth = 2; g.beginPath(); g.moveTo(view.left, view.bot + 14); g.lineTo(view.left + bar * view.sx, view.bot + 14); g.stroke();
  g.fillStyle = '#aaa'; g.font = '11px -apple-system, Helvetica, Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(`${fmtInt(bar)} m · largeur ×${fmt1(1 / ratio)}`, view.left + bar * view.sx + 8, view.bot + 14);
}
// Écart horizontal : trait horizontal (à mi-hauteur des deux points) avec deux petites barres, et la distance au-dessus
function hMeasure(c, col) {
  const ax = X(c.a.x), bx = X(c.b.x), ya = Y(c.a.z), yb = Y(c.b.z), y = (ya + yb) / 2;
  g.save(); g.strokeStyle = col; g.globalAlpha = .85; g.lineWidth = 1;
  g.setLineDash([2, 3]); g.beginPath(); g.moveTo(ax, ya); g.lineTo(ax, y); g.moveTo(bx, yb); g.lineTo(bx, y); g.stroke(); g.setLineDash([]);
  g.beginPath(); g.moveTo(ax, y); g.lineTo(bx, y); g.moveTo(ax, y - 4); g.lineTo(ax, y + 4); g.moveTo(bx, y - 4); g.lineTo(bx, y + 4); g.stroke(); g.restore();
  g.font = '700 10px -apple-system, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  outlined(`${Math.round(c.d)} m`, (ax + bx) / 2, y - 3, col);
}
function outlined(txt, x, y, col) { g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineJoin = 'round'; g.strokeText(txt, x, y); g.fillStyle = col; g.fillText(txt, x, y); }
function drawPlane(x, y, dir) {
  g.save(); g.translate(x, y); g.scale(dir, 1);
  g.fillStyle = '#e8e8e8'; g.strokeStyle = '#000'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(16, 0); g.lineTo(9, -3); g.lineTo(-12, -3); g.lineTo(-16, -9); g.lineTo(-19, -9); g.lineTo(-17, -2); g.lineTo(-17, 2); g.lineTo(9, 3); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#bbb'; g.beginPath(); g.moveTo(2, 0); g.lineTo(-4, 9); g.lineTo(-8, 9); g.lineTo(-5, 0); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
function drawPara(x, y, p, ph) {
  if (ph === 'canopy' || ph === 'open') { // voile
    g.beginPath(); g.ellipse(x, y - 11, 9, 4.5, 0, Math.PI, 0); g.fillStyle = p.color; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1; g.stroke();
    g.beginPath(); g.moveTo(x - 8, y - 11); g.lineTo(x, y); g.lineTo(x + 8, y - 11); g.strokeStyle = p.color; g.stroke();
  }
  g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.fillStyle = p.color; g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.2; g.stroke();
  g.font = '700 9px -apple-system, Helvetica, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
  g.fillText(String(p.i + 1), x, y + 0.5);
  g.font = '700 10px -apple-system, Helvetica, Arial, sans-serif'; g.textAlign = 'right';
  outlined(TYPE_LETTER[p.type] + (p.mon ? 'm' : ''), x - 9, y, p.color);
}

// ---------- Animation : lecture / pause (un seul bouton), stop ; le ralenti se fait avec la barre d'avancement ----------
let playing = false, lastTs = 0;
function frame(ts) {
  const dtR = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts;
  if (playing && SIM) {
    tNow += dtR * Math.max(0.1, +S.play || 5);
    if (tNow >= SIM.tEnd) { tNow = SIM.tEnd; playing = false; }
    draw(); syncCtrl();
  }
  requestAnimationFrame(frame);
}
// Barre d'avancement : avance pendant la lecture ; on la fait glisser pour revenir en arrière ou avancer, et au relâché c'est en pause
const scrub = $('scrub');
scrub.addEventListener('input', () => { playing = false; tNow = Math.max(0, Math.min(SIM ? SIM.tEnd : 0, +scrub.value)); draw(); syncCtrl(); });
let scrubbing = false;
scrub.addEventListener('pointerdown', () => { scrubbing = true; playing = false; syncCtrl(); });
['pointerup', 'pointercancel', 'change'].forEach(ev => scrub.addEventListener(ev, () => { scrubbing = false; playing = false; syncCtrl(); })); // relâché : pause
function syncCtrl() {
  if (SIM) { scrub.max = SIM.tEnd; if (!scrubbing) scrub.value = tNow; }
  // un seul bouton : ▶ quand c'est arrêté, ⏸ pendant la lecture
  const ic = playing ? '⏸' : '▶'; if ($('bPlay').textContent !== ic) $('bPlay').textContent = ic;
  // texte de longueur constante (toujours une décimale, vitesse toujours affichée) : la ligne du haut ne doit plus sauter
  const tTxt = (Math.round(tNow * 10) / 10).toFixed(1).replace('.', ','), spd = `×${fmt1(+S.play || 5)}`;
  const txt = SIM ? `t = ${tTxt} s · ${playing ? spd : '⏸'}` : '';
  if ($('clock').textContent !== txt) $('clock').textContent = txt;
}
$('bPlay').addEventListener('click', () => {
  if (playing) { playing = false; } else { if (SIM && tNow >= SIM.tEnd) tNow = 0; playing = true; }
  syncCtrl();
});
$('bStop').addEventListener('click', () => { playing = false; tNow = 0; draw(); syncCtrl(); });

// ---------- Panneau de réglages ----------
function openSheet() { $('sheet').classList.remove('hidden'); renderSheet(); }
function closeSheet() { $('sheet').classList.add('hidden'); }
$('btnSetup').addEventListener('click', () => $('sheet').classList.contains('hidden') ? openSheet() : closeSheet());
$('sheetClose').addEventListener('click', closeSheet);
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs [data-tab]').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('hidden', t.id !== 'tab-' + b.dataset.tab));
}));
function changed(keepTime) { save(); simulate(); if (!keepTime) { tNow = 0; playing = false; } else tNow = Math.min(tNow, SIM.tEnd); draw(); syncCtrl(); syncSummary(); }

function renderParas() {
  const ul = $('paraList'); ul.innerHTML = '';
  if (!S.paras.length) ul.innerHTML = '<li class="hint">Aucun para : ajoute-en un.</li>';
  S.paras.forEach((p, i) => {
    const li = document.createElement('li'); li.dataset.i = i;
    li.innerHTML = `<span class="hdl">≡</span><span class="num" style="color:${COLORS[i % COLORS.length]}">${i + 1}</span>
      <button class="type">${TYPE_NAMES[p.type]}</button><button class="mon ${p.mon && p.type !== 'eleve' ? 'on' : ''}" ${p.type === 'eleve' ? 'disabled' : ''}>Moniteur</button><button class="del" title="Retirer">✕</button>`;
    li.querySelector('.type').onclick = () => { p.type = NEXT_TYPE[p.type] || 'plat'; if (p.type === 'eleve') p.mon = false; renderParas(); changed(); };
    li.querySelector('.mon').onclick = () => { p.mon = !p.mon; renderParas(); changed(); };
    li.querySelector('.del').onclick = () => { S.paras.splice(i, 1); renderParas(); changed(); };
    dragHandle(li.querySelector('.hdl'), li);
    ul.append(li);
  });
}
// Glisser ≡ pour changer l'ordre de sortie
function dragHandle(h, li) {
  h.addEventListener('pointerdown', e => {
    e.preventDefault(); h.setPointerCapture(e.pointerId);
    const ul = $('paraList'), items = [...ul.children], from = items.indexOf(li), hgt = li.getBoundingClientRect().height, y0 = e.clientY;
    let to = from; li.classList.add('drag');
    const move = ev => {
      const dy = ev.clientY - y0; li.style.transform = `translateY(${dy}px)`;
      to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / hgt)));
    };
    const up = () => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      li.classList.remove('drag'); li.style.transform = '';
      if (to !== from) { const [p] = S.paras.splice(from, 1); S.paras.splice(to, 0, p); changed(); }
      renderParas();
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  });
}
$('addPara').addEventListener('click', () => { S.paras.push({ type: 'plat', mon: false }); renderParas(); changed(); });
$('clearParas').addEventListener('click', async () => { if (await ask('Retirer tous les paras ?')) { S.paras = []; renderParas(); changed(); } });

function bindNum(id, get, set, keepTime) {
  const el = $(id);
  el.addEventListener('change', () => { const v = num(el.value); if (isNaN(v) || v < 0) { fillInputs(); return; } set(v); fillInputs(); changed(keepTime); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') el.blur(); });
  el._get = get;
}
const inputs = [];
function reg(id, get, set, keepTime) { bindNum(id, get, set, keepTime); inputs.push(id); }
reg('p_speed', () => S.speed, v => { S.speed = Math.max(20, v); });
reg('p_height', () => S.height, v => { S.height = Math.max(1600, v); });
reg('p_sep', () => sepNow(), v => { S.sep = Math.max(1, v); });
reg('p_vz', () => S.vz, v => { S.vz = Math.max(1, v); });
reg('p_vzMon', () => S.vzMon, v => { S.vzMon = Math.max(1, v); });
reg('p_openLoss', () => S.openLoss, v => { S.openLoss = Math.max(10, v); });
reg('p_gap', () => S.gap, v => { S.gap = Math.max(10, v); });
reg('p_dot', () => S.dot, v => { S.dot = Math.max(1, v); });
reg('p_play', () => S.play, v => { S.play = Math.max(0.2, v); }, true);
['vertical', 'plat', 'eleve'].forEach(t => ['vt', 'd10', 'hOpen'].forEach(k => reg(`t_${t}_${k}`, () => S.types[t][k], v => { S.types[t][k] = v; })));
function fillInputs() {
  inputs.forEach(id => { const el = $(id); if (document.activeElement !== el) el.value = fmt1(el._get()); });
  $('sepAuto').classList.toggle('primary', S.sep == null);
  const head = -(S.dir === 'R' ? 1 : -1) * windAt((+S.height || 4000) - 1); // > 0 : vent de face à la hauteur de largage
  const wTxt = Math.abs(head) < 0.05 ? 'sans vent' : `vent ${head > 0 ? 'de face' : 'arrière'} ${fmt1(Math.abs(head))} m/s`;
  $('sepHint').textContent = `Auto : ${autoSep()} s = ${fmtInt(+S.gap || 300)} m à ${fmtInt(groundSpeed() / KT)} kt sol (${fmtInt(S.speed)} kt, ${wTxt})`;
  $('dirL').classList.toggle('on', S.dir !== 'R'); $('dirR').classList.toggle('on', S.dir === 'R');
}
$('sepAuto').addEventListener('click', () => { S.sep = null; fillInputs(); changed(); });
$('dirL').addEventListener('click', () => { S.dir = 'L'; fillInputs(); changed(); });
$('dirR').addEventListener('click', () => { S.dir = 'R'; fillInputs(); changed(); });
$('resetParams').addEventListener('click', async () => {
  if (!(await ask('Remettre les paramètres des chuteurs, sous voile et d\'affichage aux valeurs par défaut ?'))) return;
  ['vz', 'vzMon', 'openLoss', 'gap', 'dot', 'play'].forEach(k => { S[k] = DEF[k]; }); S.types = clone(DEF.types); fillInputs(); changed();
});

// Vents enregistrés : une liste de profils (4 tranches) pour montrer ce qu'on veut en cours
function renderWinds() {
  const sel = $('windSel'); sel.innerHTML = '';
  S.winds.forEach((w, i) => { const o = document.createElement('option'); o.value = i; o.textContent = w.name; sel.append(o); });
  sel.value = S.windIdx;
  const box = $('windLayers'), H = +S.height || 4000, w = S.winds[S.windIdx].w; box.innerHTML = '';
  for (let i = 3; i >= 0; i--) {
    const row = document.createElement('div'); row.className = 'wl';
    row.innerHTML = `<span>${fmtInt(i * H / 4)} – ${fmtInt((i + 1) * H / 4)} m</span><input inputmode="decimal" value="${fmt1(+w[i] || 0)}"><small>m/s · ${Math.round((+w[i] || 0) / KT)} kt</small>`;
    const inp = row.querySelector('input');
    inp.addEventListener('change', () => { const v = num(inp.value); if (!isNaN(v)) w[i] = v; renderWinds(); changed(); });
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    box.append(row);
  }
  $('windDelete').disabled = S.winds.length <= 1;
  const vg = SIM ? SIM.vpg : 0;
  $('windHint').textContent = SIM ? `Vitesse sol de l'avion : ${fmtInt(Math.abs(vg) / KT)} kt (${fmt1(Math.abs(vg))} m/s) → ${fmtInt(Math.abs(vg) * SIM.sep)} m entre deux sorties au moment de sortir. Une valeur négative = vent de la gauche.` : '';
}
$('windSel').addEventListener('change', e => { S.windIdx = +e.target.value; renderWinds(); changed(); });
$('windSaveAs').addEventListener('click', async () => {
  const n = await ask('Nom de ce vent (ex. « Cisaillement au sol ») :', ''); if (!n || !n.trim()) return;
  S.winds.push({ name: n.trim(), w: S.winds[S.windIdx].w.slice() }); S.windIdx = S.winds.length - 1; renderWinds(); changed(); toast('Vent enregistré');
});
$('windDelete').addEventListener('click', async () => {
  if (S.winds.length <= 1) return;
  if (!(await ask(`Supprimer le vent « ${S.winds[S.windIdx].name} » ?`))) return;
  S.winds.splice(S.windIdx, 1); S.windIdx = 0; renderWinds(); changed();
});
function renderSheet() { renderParas(); fillInputs(); renderWinds(); }
function syncSummary() {
  if (!SIM) return;
  $('summary').innerHTML = `${S.paras.length} para${S.paras.length > 1 ? 's' : ''} · ${fmtInt(S.speed)} kt · ${SIM.sep} s entre sorties<br>${S.dir === 'R' ? 'face au vent →' : '← vent dans le dos'} · ${S.winds[S.windIdx].name}`;
  if (!$('sheet').classList.contains('hidden')) { renderWinds(); fillInputs(); } // Auto suit le vent : temps entre sorties à jour
}

// ---------- Boîte de dialogue et messages ----------
function ask(text, def) {
  return new Promise(res => {
    $('dlgText').textContent = text; $('dlgInput').value = def || ''; $('dialog').classList.remove('hidden');
    $('dlgInput').classList.toggle('hidden', def === undefined);
    const done = v => { $('dialog').classList.add('hidden'); $('dlgOk').onclick = $('dlgCancel').onclick = null; res(v); };
    $('dlgOk').onclick = () => done(def === undefined ? true : $('dlgInput').value.trim());
    $('dlgCancel').onclick = () => done(null);
    if (def !== undefined) setTimeout(() => $('dlgInput').focus(), 50);
  });
}
let toastT;
function toast(t) { const el = $('toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.add('hidden'), 2600); }
// iOS : après le clavier, remettre la page en place (sinon les appuis tombent à côté)
document.addEventListener('focusout', () => setTimeout(() => window.scrollTo(0, 0), 50));

// ---------- Démarrage ----------
$('ver').textContent = VERSION;
simulate(); resize(); syncCtrl(); syncSummary();
window.addEventListener('resize', () => setTimeout(resize, 120));
requestAnimationFrame(frame);

// Mise à jour automatique (comme les autres applis) : jamais pendant qu'une question est affichée
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reloadWhenFree = () => { const d = $('dialog'); if (d && !d.classList.contains('hidden')) { setTimeout(reloadWhenFree, 400); return; } location.reload(); };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; reloadWhenFree(); } });
  navigator.serviceWorker.register('sw.js').then(reg => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
