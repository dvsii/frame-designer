/* Frame Designer core: frame sizing, joinery, cut list and stock layout.
   Pure functions with no DOM access. Every length is in inches internally;
   formatting converts to the user's units at the edges. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FWCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MM = 25.4;
  const DEG = 180 / Math.PI;

  const JOINTS = [
    { id: 'miter', name: 'Miter', through: false,
      blurb: 'Angled corners with the grain running unbroken around the frame. The joint is end grain, so glue alone suits small frames; add V-nails or biscuits on bigger ones.' },
    { id: 'miterspline', name: 'Miter w/ spline', through: false,
      blurb: 'A miter with triangular splines glued into slots sawn across each corner after glue-up. Much stronger than a plain miter, and contrasting splines are decorative.' },
    { id: 'halflap', name: 'Half-lap', through: true,
      blurb: 'Both pieces are cut to half thickness where they overlap. A big glue area makes it very strong; end grain shows on the outside edges.' },
    { id: 'mitredlap', name: 'Mitered half-lap', through: false,
      blurb: 'A miter on the face with a half-lap behind it: the look of a miter with many times the glue area.' },
    { id: 'bridle', name: 'Bridle', through: true,
      blurb: 'An open slot in one piece takes a full-width tenon on the other. Strong, and easy to cut on the table saw.' },
    { id: 'mortise', name: 'Mortise & tenon', through: true,
      blurb: 'A hidden tenon glued into a mortise. The traditional joint for sash, door and Arts & Crafts frames.' },
    { id: 'tongue', name: 'Tongue & groove', through: true,
      blurb: 'A groove runs along every inside edge and short tongues on the rails fit into it. Quick with a dado stack or slot cutter.' },
    { id: 'cope', name: 'Cope & stick', through: true,
      blurb: 'Matched router bits profile the inside edges and cope the rail ends to fit over them, as on a cabinet door.' },
    { id: 'butt', name: 'Butt joint', through: true,
      blurb: 'Square-cut ends held with dowels, biscuits, pocket screws or loose tenons. The fastest frame to make.' },
  ];
  const JOINT_BY_ID = Object.fromEntries(JOINTS.map(j => [j.id, j]));

  const BISCUITS = [
    { name: '#20', len: 2.375, wid: 0.9375 },
    { name: '#10', len: 2.125, wid: 0.75 },
    { name: '#0', len: 1.875, wid: 0.625 },
    { name: 'FF', len: 1.5, wid: 0.5 },
  ];
  const DOMINOS = [
    { name: '4 × 20 mm', maxT: 0.6, t: 4 / MM, w: 17 / MM, len: 20 / MM },
    { name: '5 × 30 mm', maxT: 0.85, t: 5 / MM, w: 19 / MM, len: 30 / MM },
    { name: '6 × 40 mm', maxT: 1.15, t: 6 / MM, w: 20 / MM, len: 40 / MM },
    { name: '8 × 40 mm', maxT: Infinity, t: 8 / MM, w: 22 / MM, len: 40 / MM },
  ];
  // Pocket screw length by stock thickness (inches), after the common jig charts.
  const POCKET = [[0.5, 1], [0.625, 1], [0.75, 1.25], [0.875, 1.5], [1, 1.5], [1.125, 1.5], [1.25, 2], [1.375, 2], [1.5, 2.5]];
  const VNAILS_MM = [7, 10, 12, 15];

  function defaultState() {
    return {
      v: 2,
      units: 'in', precIn: 16, precMm: 0.5,
      joint: 'miter',
      solve: 'outside',          // which quantity is calculated: outside | opening | widths
      innerRef: 'art',           // the inner size means the artwork (glass) or the sight opening
      inner: { w: 11, h: 14 },
      outside: { w: 0, h: 0 },
      stile: 2, top: 2, bottom: 2, linkWidths: true,
      thickness: 0.75,
      rabbetW: 0.375, rabbetD: 0.375, clearance: 0.125,
      mat: { on: false, side: 2, top: 2, bottom: 2.5, overlap: 0.125 },
      through: 'stiles',
      jp: {},                    // per-joint overrides; missing means automatic
      // source: 'strips' = stock already at frame width, 'boards' = rip from the boards listed,
      // 'molding' = ready-made molding whose profile sets the widths, thickness and rabbet.
      stock: { length: 96, kerf: 0.125, trim: 0, grain: true, source: 'strips', boards: [], buy: true, suggest: true },
      qty: 1,
    };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function num(v, fallback) { return typeof v === 'number' && isFinite(v) ? v : fallback; }

  function normalizeState(input) {
    const base = defaultState();
    const s = Object.assign(base, clone(input || {}));
    const def = defaultState();
    s.inner = Object.assign(def.inner, s.inner);
    s.outside = Object.assign(def.outside, s.outside);
    s.mat = Object.assign(def.mat, s.mat);
    s.stock = Object.assign(def.stock, s.stock);
    s.jp = Object.assign({}, s.jp);
    // Before v2 the splined miter was the 'miter' joint with keys as its default reinforcement.
    if (s.joint === 'miter' && (s.jp.miterReinf === 'keys' || (input && input.v === 1 && s.jp.miterReinf == null))) {
      s.joint = 'miterspline';
      delete s.jp.miterReinf;
    }
    s.v = 2;
    if (!JOINT_BY_ID[s.joint]) s.joint = 'miter';
    if (!['outside', 'opening', 'widths'].includes(s.solve)) s.solve = 'outside';
    if (!['art', 'sight'].includes(s.innerRef)) s.innerRef = 'art';
    if (!['stiles', 'rails'].includes(s.through)) s.through = 'stiles';
    if (s.units !== 'mm') s.units = 'in';
    if (![8, 16, 32, 'dec'].includes(s.precIn)) s.precIn = 16;
    if (![1, 0.5, 0.1].includes(s.precMm)) s.precMm = 0.5;
    for (const k of ['stile', 'top', 'bottom', 'thickness', 'rabbetW', 'rabbetD', 'clearance']) s[k] = num(s[k], def[k]);
    for (const k of ['w', 'h']) { s.inner[k] = num(s.inner[k], def.inner[k]); s.outside[k] = num(s.outside[k], 0); }
    s.qty = Math.max(1, Math.min(99, Math.round(num(s.qty, 1))));
    s.stock.length = Math.max(1, num(s.stock.length, 96));
    if (!['strips', 'boards', 'molding'].includes(s.stock.source)) s.stock.source = 'strips';
    s.stock.boards = (Array.isArray(s.stock.boards) ? s.stock.boards : []).slice(0, 50).map(b => ({
      w: Math.max(0.01, num(b && b.w, 3.5)), t: Math.max(0.01, num(b && b.t, 0.75)), l: Math.max(0.1, num(b && b.l, 96)),
      n: Math.max(1, Math.min(99, Math.round(num(b && b.n, 1)))),
    }));
    for (const k of ['buy', 'suggest', 'grain']) s.stock[k] = s.stock[k] !== false;
    if (s.stock.source === 'molding') {
      // A molding profile is the same all round, so the widths can't be the calculated quantity.
      s.linkWidths = true;
      if (s.solve === 'widths') s.solve = 'outside';
    }
    if (s.solve === 'widths') s.linkWidths = false;
    if (s.linkWidths) s.top = s.bottom = s.stile;
    return s;
  }

  /* ---------- Formatting and parsing ---------- */

  function trimZeros(t) { return t.indexOf('.') >= 0 ? t.replace(/\.?0+$/, '') : t; }

  function fmtLen(v, units, prec, opts) {
    opts = opts || {};
    const unit = opts.unit !== false;
    if (!isFinite(v)) return '—';
    if (units === 'mm') {
      const step = prec || 0.5;
      const r = Math.round(v * MM / step) * step;
      return trimZeros(r.toFixed(step < 1 ? 1 : 0)) + (unit ? ' mm' : '');
    }
    if (prec === 'dec') return trimZeros(v.toFixed(3)) + (unit ? '"' : '');
    const D = prec || 16;
    const neg = v < 0;
    const a = Math.abs(v);
    const n = Math.round(a * D);
    const err = a - n / D;
    const whole = Math.floor(n / D);
    let numr = n % D, den = D;
    while (numr && numr % 2 === 0) { numr /= 2; den /= 2; }
    let t = numr ? (whole ? `${whole} ${numr}/${den}` : `${numr}/${den}`) : `${whole}`;
    if (unit) t += '"';
    if (opts.mark !== false && Math.abs(err) > 1 / (4 * D) && n > 0) t += err > 0 ? '+' : '−';
    return (neg && n > 0 ? '−' : '') + t;
  }

  function fmtAngle(a) {
    const r = Math.round(a);
    return Math.abs(a - r) < 0.05 ? `${r}°` : `${a.toFixed(1)}°`;
  }

  function parseNum(t) {
    t = t.trim();
    let m = t.match(/^(\d+(?:\.\d+)?)[ -]+(\d+)\/(\d+)$/);
    if (m) return +m[3] ? +m[1] + +m[2] / +m[3] : NaN;
    m = t.match(/^(\d+)\/(\d+)$/);
    if (m) return +m[2] ? +m[1] / +m[2] : NaN;
    return parseFloat(t);
  }

  /** Parse a length typed by a person: 11 3/4, 11-3/4, 11.75", 298mm, 1' 2 1/2". Returns inches or NaN. */
  function parseLen(input, units) {
    if (typeof input === 'number') return input;
    let s = String(input == null ? '' : input).trim().toLowerCase();
    if (!s) return NaN;
    s = s.replace(/[″”"]/g, ' in ').replace(/[′’']/g, ' ft ').replace(/,/g, '.')
      .replace(/\s+/g, ' ').trim().replace(/[+−]+$/, '').trim();
    const re = /(\d+(?:\.\d+)?[ -]+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|m|inches|inch|in|feet|foot|ft)?/g;
    const toIn = { mm: 1 / MM, cm: 10 / MM, m: 1000 / MM, in: 1, ft: 12 };
    const alias = { inch: 'in', inches: 'in', feet: 'ft', foot: 'ft' };
    let total = 0, count = 0, lastUnit = null, lastExplicit = true, m;
    while ((m = re.exec(s))) {
      if (count > 0 && !lastExplicit) return NaN;      // "2 3" is ambiguous
      const val = parseNum(m[1]);
      if (!isFinite(val)) return NaN;
      let unit = m[2] ? (alias[m[2]] || m[2]) : null;
      lastExplicit = !!unit;
      if (!unit) unit = lastUnit === 'ft' ? 'in' : (units === 'mm' ? 'mm' : 'in');
      total += val * toIn[unit];
      lastUnit = unit;
      count++;
    }
    if (!count || s.replace(re, '').replace(/\s+/g, '')) return NaN;
    return total;
  }

  function makeFmt(s) {
    const prec = s.units === 'mm' ? s.precMm : s.precIn;
    return {
      units: s.units,
      L: v => fmtLen(v, s.units, prec),
      plain: v => fmtLen(v, s.units, prec, { unit: false }),
      A: fmtAngle,
      n: v => String(v),
    };
  }

  function nice(v, units) {
    if (units === 'mm') return Math.round(v * MM * 2) / 2 / MM;
    return Math.round(v * 16) / 16;
  }
  function niceDown(v, units) {
    if (units === 'mm') return Math.floor(v * MM * 2) / 2 / MM;
    return Math.floor(v * 16) / 16;
  }

  /* ---------- Sizes ---------- */

  function matOffsets(s) {
    if (!s.mat.on) return { w: 0, h: 0 };
    return { w: 2 * s.mat.side - 2 * s.mat.overlap, h: s.mat.top + s.mat.bottom - 2 * s.mat.overlap };
  }

  /** Work out every size from the state. Writes the calculated values back into s. */
  function solve(s, F) {
    const R = Math.max(0, s.rabbetW), c = Math.max(0, s.clearance);
    const mo = matOffsets(s);
    const toSight = s.innerRef === 'sight' ? { w: 0, h: 0 } : { w: mo.w + c - 2 * R, h: mo.h + c - 2 * R };
    let SW, SH;
    if (s.solve === 'opening') {
      SW = s.outside.w - 2 * s.stile;
      SH = s.outside.h - s.top - s.bottom;
      s.inner.w = SW - toSight.w;
      s.inner.h = SH - toSight.h;
    } else {
      SW = s.inner.w + toSight.w;
      SH = s.inner.h + toSight.h;
      if (s.solve === 'outside') {
        s.outside.w = SW + 2 * s.stile;
        s.outside.h = SH + s.top + s.bottom;
      } else {
        s.stile = (s.outside.w - SW) / 2;
        const vert = s.outside.h - SH;
        const ratio = s.top > 0 && s.bottom > 0 ? s.bottom / s.top : 1;
        s.top = vert / (1 + ratio);
        s.bottom = vert - s.top;
      }
    }
    const d = {
      OW: s.outside.w, OH: s.outside.h, SW, SH,
      RW: SW + 2 * R, RH: SH + 2 * R, GW: SW + 2 * R - c, GH: SH + 2 * R - c,
      ws: s.stile, wT: s.top, wB: s.bottom, T: s.thickness, R, D: Math.max(0, s.rabbetD), c,
      warnings: [],
    };
    d.diag = Math.hypot(d.OW, d.OH);
    if (s.mat.on) {
      d.IW = d.GW - mo.w; d.IH = d.GH - mo.h;
      d.MW = d.IW - 2 * s.mat.overlap; d.MH = d.IH - 2 * s.mat.overlap;
    }
    const W = d.warnings;
    const err = text => W.push({ level: 'error', text });
    const warn = text => W.push({ level: 'warn', text });
    const minW = Math.min(d.ws, d.wT, d.wB);
    if (minW <= 0) err('A rail or stile width is zero or less. Make the outside size bigger or the artwork smaller.');
    else if (minW <= R + 0.125) err(`Every frame member must be wider than the rabbet (${F.L(R)}) by at least 1/8". Widen the members or narrow the rabbet.`);
    if (SW <= 0 || SH <= 0) err('The sight opening has no room left. Make the outside size bigger or the members narrower.');
    if (d.T <= 0) err('Stock thickness must be greater than zero.');
    else if (d.D >= d.T) err('The rabbet is as deep as the stock is thick. Make it shallower.');
    else if (d.T - d.D < 0.1875) warn(`The lip in front of the rabbet is only ${F.L(d.T - d.D)} thick and may break off. Aim for at least 1/4".`);
    if (d.GW <= 0 || d.GH <= 0) err('The glass size works out to zero or less. Check the artwork size and the rabbet width.');
    if (s.mat.on && (d.MW <= 0 || d.MH <= 0)) err('The mat window is too small. Reduce the mat borders or the overlap.');
    if (R > 0 && d.D > 0 && d.D < 0.125) warn('A rabbet under 1/8" deep will not hold glass, art and backer. Most frames need 3/8" or more.');
    return d;
  }

  /* ---------- Joint parameters ---------- */

  function dowelSizes(units) {
    return units === 'mm' ? [6, 8, 10, 12].map(v => v / MM) : [0.25, 0.3125, 0.375, 0.5];
  }
  function pocketScrew(T) {
    let best = POCKET[0][1];
    for (const [t, l] of POCKET) if (t <= T + 0.03) best = l;
    return best;
  }

  function resolveParams(s, d) {
    const u = s.units, jp = s.jp || {}, T = d.T;
    const auto = {};
    const pos = (k, v) => { auto[k] = v; const o = jp[k]; return typeof o === 'number' && isFinite(o) && o > 0 ? o : v; };
    const nonneg = (k, v) => { auto[k] = v; const o = jp[k]; return typeof o === 'number' && isFinite(o) && o >= 0 ? o : v; };
    const pickEnum = (k, v, allowed) => { auto[k] = v; return allowed.includes(jp[k]) ? jp[k] : v; };
    const joint = JOINT_BY_ID[s.joint];
    const thr = joint.through && s.through === 'rails';
    const wThrough = thr ? Math.min(d.wT, d.wB) : d.ws;          // member that runs through
    const wJoin = thr ? d.ws : Math.min(d.wT, d.wB);              // member that joins into it
    const p = { auto, thr };

    p.miterReinf = s.joint === 'miterspline' ? 'keys' : pickEnum('miterReinf', 'none', ['vnails', 'biscuits', 'none']);
    p.keys = pickEnum('keys', T >= 1 ? 2 : 1, [1, 2, 3]);
    p.keyThick = pos('keyThick', u === 'mm' ? 3 / MM : 0.125);
    const keyRoom = d.ws + Math.min(d.wT, d.wB) - 2 * d.R;
    p.keyLeg = pos('keyLeg', Math.max(0.25, nice(Math.min(u === 'mm' ? 38 / MM : 1.5, 0.6 * keyRoom), u)));

    p.lapDepth = pos('lapDepth', nice(T / 2, u));
    p.tenonThick = pos('tenonThick', Math.max(nice(T / 3, u), 0.0625));
    p.tenonLen = pos('tenonLen', Math.max(0.25, nice(Math.min(wThrough * 2 / 3, wThrough - 0.25), u)));
    p.shoulderOut = nonneg('shoulderOut', nice(Math.min(0.25, wJoin / 6), u));
    const cheek = (T - p.tenonThick) / 2;
    p.shoulderIn = nonneg('shoulderIn', d.D > cheek + 1e-6 ? nice(d.R + 0.0625, u) : nice(Math.min(0.125, wJoin / 8), u));
    p.horn = nonneg('horn', 0);

    p.grooveW = pos('grooveW', Math.max(nice(T / 3, u), 0.0625));
    p.grooveD = pos('grooveD', Math.max(0.125, nice(Math.min(0.375, Math.min(d.ws, d.wT, d.wB) / 4), u)));
    p.copeD = pos('copeD', u === 'mm' ? 9.5 / MM : 0.375);

    p.buttReinf = pickEnum('buttReinf', 'dowels', ['dowels', 'biscuits', 'pocket', 'domino']);
    const sizes = dowelSizes(u);
    let dia = sizes[0];
    for (const z of sizes) if (z <= T / 2 + 1e-6) dia = z;
    p.dowelDia = pos('dowelDia', dia);
    p.dowelLen = pos('dowelLen', Math.max(0.75, nice(Math.min(2, 2 * Math.min(1, wThrough - 0.375)), u)));
    return p;
  }

  /** How far into a member's width a centered fastener can sit without the rabbet cutting into it. */
  function bandFor(w, d, size, z) {
    const zc = z == null ? d.T / 2 : z;
    const conflict = d.R > 0 && d.D > zc - size / 2 - 1e-6;
    return conflict ? Math.max(0, w - d.R) : w;
  }
  function spread(band, count, edge) {
    if (count <= 1) return [band / 2];
    const inset = Math.min(band / 2, Math.max(edge, band / (2 * count)));
    const out = [];
    for (let i = 0; i < count; i++) out.push(inset + (band - 2 * inset) * i / (count - 1));
    return out;
  }

  /** Fastener layout for one butt joint whose joining member is w wide. Positions are from the outer edge. */
  function fastenerPlan(d, p, w) {
    const kind = p.buttReinf, T = d.T;
    if (kind === 'dowels') {
      const band = bandFor(w, d, p.dowelDia);
      const count = band >= 2.25 ? 2 : 1;
      return { kind, count, band, positions: spread(band, count, p.dowelDia), dia: p.dowelDia, len: p.dowelLen, z: T / 2 };
    }
    if (kind === 'biscuits') {
      const lip = T - d.D;
      const inLip = d.R > 0 && lip >= 0.3;
      const z = inLip ? d.D + lip / 2 : T / 2;
      const band = inLip || d.R === 0 ? w : bandFor(w, d, 0.16, z);
      const biscuit = BISCUITS.find(b => b.len + 0.25 <= band) || null;
      return { kind, count: biscuit ? 1 : 0, band, positions: [band / 2], biscuit, z };
    }
    if (kind === 'pocket') {
      const band = Math.max(0, w - d.R);
      const count = band < 1.25 ? 1 : band < 3.25 ? 2 : 3;
      return { kind, count, band, positions: spread(band, count, 0.375), screw: pocketScrew(T) };
    }
    const dm = DOMINOS.find(x => T <= x.maxT);
    const band = bandFor(w, d, dm.t);
    const count = band >= 3 ? 2 : 1;
    return { kind: 'domino', count, band, positions: spread(band, count, dm.w / 2 + 0.125), domino: dm, z: T / 2 };
  }

  /* ---------- Joints: cut list rows, joinery notes, hardware ---------- */

  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  function rowsHelpers(d) {
    const same = Math.abs(d.wT - d.wB) < 1e-6;
    return {
      same,
      rails(make) {
        if (same) return [Object.assign({ key: 'rails', name: 'Top & bottom rails', qty: 2, width: d.wT, thick: d.T }, make('top', d.wT))];
        return [
          Object.assign({ key: 'top', name: 'Top rail', qty: 1, width: d.wT, thick: d.T }, make('top', d.wT)),
          Object.assign({ key: 'bottom', name: 'Bottom rail', qty: 1, width: d.wB, thick: d.T }, make('bottom', d.wB)),
        ];
      },
      stiles(props) { return Object.assign({ key: 'stiles', name: 'Stiles (sides)', qty: 2, width: d.ws, thick: d.T }, props); },
    };
  }

  function rabbetAfterCard(d, F) {
    return { title: 'Rabbet', lines: [
      `Rout the ${F.L(d.R)} wide × ${F.L(d.D)} deep rabbet after glue-up, with a bearing-guided rabbeting bit run clockwise around the back.`,
      'The bit leaves rounded inside corners. Square them with a chisel so the glass sits flat.',
    ] };
  }

  /** The groove in tongue & groove and cope & stick frames shows on the inside edge unless the rabbet removes it. */
  function grooveShowCheck(d, gw, gd, F, out) {
    const z1 = (d.T + gw) / 2;                                    // groove's front wall, from the back
    if (d.R >= gd - 1e-6 && d.D >= z1 - 1e-6) return 'The rabbet removes the groove completely, so nothing shows on the inside edge.';
    const need = Math.max(z1, d.D);
    out.warnings.push({ level: 'warn', text: `Part of the groove will show along the inside edge of the frame. A rabbet ${F.L(Math.max(d.R, gd))} wide × ${F.L(need)} deep removes it.` });
    return `To hide the groove, make the rabbet at least ${F.L(Math.max(d.R, gd))} wide and ${F.L(need)} deep.`;
  }

  const J = {};

  J.miter = (s, d, p, F, o) => {
    const { ws, wT, wB, OW, OH, SW, SH, R, T, D } = d;
    const H = rowsHelpers(d);
    const rA = w => Math.atan2(ws, w) * DEG;   // rail end, measured from square, where it meets a stile
    const sA = w => Math.atan2(w, ws) * DEG;   // stile end where it meets a rail w wide
    const square = Math.abs(wT - ws) < 1e-6 && Math.abs(wB - ws) < 1e-6;
    o.rows.push(...H.rails((which, w) => ({
      length: OW, short: SW, atRabbet: square ? SW + 2 * R : null, angles: [rA(w), rA(w)],
      ends: `${F.A(rA(w))} both ends`,
    })));
    const aT = sA(wT), aB = sA(wB);
    o.rows.push(H.stiles({
      length: OH, short: SH, atRabbet: square ? SH + 2 * R : null, angles: [aT, aB],
      ends: Math.abs(aT - aB) < 0.05 ? `${F.A(aT)} both ends` : `${F.A(aT)} top, ${F.A(aB)} bottom`,
    }));
    o.lengthNote = 'Lengths are long points, measured along the outside edge.';
    const miterLines = [];
    if (square) miterLines.push('Cut every end at 45°. Measure each piece on its long point, the outside edge.');
    else miterLines.push(`Unequal widths move the miter line off 45° so it still runs corner to corner. Saw settings from square: top rail ${F.A(rA(wT))}, bottom rail ${F.A(rA(wB))}, stiles ${F.A(aT)} at the top and ${F.A(aB)} at the bottom.`);
    if (square) miterLines.push(`Check on the rabbet: rails should measure ${F.L(SW + 2 * R)} and stiles ${F.L(SH + 2 * R)} along the rabbet edge, the glass size plus ${F.L(d.c)}.`);
    miterLines.push(`Glue face on each miter: ${F.L(Math.hypot(ws, wT))} long${Math.abs(wT - wB) > 1e-6 ? ` at the top, ${F.L(Math.hypot(ws, wB))} at the bottom` : ''}.`);
    o.cards.push({ title: 'Miters', lines: miterLines });

    const q = s.qty;
    if (p.miterReinf === 'keys') {
      const n = p.keys, kt = p.keyThick, Lk = p.keyLeg, h = Lk / Math.SQRT2;
      const zs = [];
      for (let i = 1; i <= n; i++) zs.push(T * i / (n + 1));
      let worst = Infinity;
      for (const wr of [wT, wB]) for (const zf of zs) {
        const inBack = R > 0 && (T - zf) - kt / 2 < D;
        worst = Math.min(worst, (inBack ? ws + wr - 2 * R : ws + wr) - 0.125);
      }
      if (Lk > worst) o.warnings.push({ level: 'warn', text: `Splines showing ${F.L(Lk)} along each edge would cut into the ${worst < ws + Math.min(wT, wB) - 0.2 ? 'rabbet' : 'opening'}. Use ${F.L(niceDown(Math.max(0, worst), s.units))} or smaller.` });
      if (kt >= T / 2) o.warnings.push({ level: 'warn', text: 'Spline slots that thick leave little wood on either side. Keep splines under a third of the stock thickness.' });
      o.cards.push({ title: 'Splines', lines: [
        `${plural(n, 'spline')} per corner, ${F.L(kt)} thick, showing ${F.L(Lk)} along each outside edge.`,
        `Cut the slots after glue-up on a 45° cradle sled, with the blade ${F.L(h)} above the bottom of the cradle.`,
        `Center the slot${n > 1 ? 's' : ''} ${zs.map(F.L).join(', ')} from the front face.`,
        'Orient the spline grain along its long edge, across the joint line. Glue in, then trim flush.',
      ] });
      const count = 4 * n * q;
      const leg = Lk + 0.25, stripW = leg / Math.SQRT2;
      const stripLen = (count + 1) * stripW + count * s.stock.kerf * 1.5;
      o.materials.push({ name: 'Spline stock', qty: count, size: `${F.L(kt)} × ${F.L(stripW)} × ${F.L(stripLen)} strip`, note: 'contrasting wood, grain lengthwise; cut triangles alternately' });
    } else if (p.miterReinf === 'vnails') {
      let size = VNAILS_MM[0];
      for (const v of VNAILS_MM) if (v <= 0.65 * T * MM) size = v;
      const n = Math.min(ws, wT, wB) - R >= 1.25 ? 2 : 1;
      o.cards.push({ title: 'V-nails', lines: [
        `Glue the miters in a band clamp, then drive ${plural(n, 'V-nail')} (${size} mm) into each corner from the back.`,
        `Keep them on the solid part of the back, outside the ${F.L(R)} rabbet.`,
        'Use hardwood V-nails for oak, maple and other dense woods.',
      ] });
      o.materials.push({ name: `V-nails, ${size} mm`, qty: 4 * n * q, size: '', note: 'hardwood type for dense species' });
    } else if (p.miterReinf === 'biscuits') {
      const lip = T - D;
      const avail = Math.hypot(ws, Math.min(wT, wB));
      const b = BISCUITS.find(x => x.len + 0.25 <= avail);
      if (lip < 0.3) o.warnings.push({ level: 'warn', text: `The lip in front of the rabbet is ${F.L(lip)} thick, too thin for a biscuit slot. Use V-nails, or a miter with splines.` });
      if (!b) o.warnings.push({ level: 'warn', text: 'The miter face is too short for even an FF biscuit. Use V-nails, or a miter with splines.' });
      else {
        o.cards.push({ title: 'Biscuits', lines: [
          `One ${b.name} biscuit per corner, centered on the miter face.`,
          `Center the slot ${F.L(lip / 2)} from the front face so it stays in the solid lip, clear of the rabbet.`,
          b.name === 'FF' ? 'FF biscuits need a joiner with a small (face frame) blade.' : 'Clamp the frame in a band clamp while the glue sets.',
        ] });
        o.materials.push({ name: `Biscuits, ${b.name}`, qty: 4 * q, size: '', note: '' });
      }
    } else {
      o.cards.push({ title: 'Glue only', lines: [
        'Glue holds end grain poorly. Size the miters with thin glue first, let it tack, then glue up in a band clamp.',
        'Fine for small frames with a firm backer; reinforce anything larger.',
      ] });
      if (OW + OH > 32) o.warnings.push({ level: 'warn', text: 'A glue-only miter is weak at this size. Add V-nails or biscuits, or use a miter with splines.' });
    }
  };

  J.miterspline = J.miter;

  J.halflap = (s, d, p, F, o) => {
    const { ws, wT, wB, OW, OH, T } = d;
    const H = rowsHelpers(d);
    const dd = p.lapDepth;
    const thr = p.thr;
    if (dd <= 0.0625 || dd >= T - 0.0625) o.warnings.push({ level: 'error', text: `Lap depth must be between 1/16" and ${F.L(T - 0.0625)}.` });
    const railFace = thr ? `from the back, ${F.L(dd)} deep` : `from the front, ${F.L(T - dd)} deep`;
    const stileFace = thr ? `from the front, ${F.L(T - dd)} deep` : `from the back, ${F.L(dd)} deep`;
    o.rows.push(...H.rails(() => ({ length: OW, angles: [0, 0], ends: 'Square', notes: `Lap ${F.L(ws)} long each end, ${railFace}` })));
    o.rows.push(H.stiles({ length: OH, angles: [0, 0], ends: 'Square',
      notes: Math.abs(wT - wB) < 1e-6 ? `Lap ${F.L(wT)} long each end, ${stileFace}` : `Laps ${F.L(wT)} top, ${F.L(wB)} bottom, ${stileFace}` }));
    o.lengthNote = 'Every piece runs the full outside length.';
    const tn = thr ? 'rails' : 'stiles', on = thr ? 'stiles' : 'rails';
    o.cards.push({ title: 'Laps', lines: [
      `The ${tn} show on the front, running through to the corners. Cut their laps from the back, ${F.L(dd)} deep.`,
      `Cut the ${on}' laps from the front, ${F.L(T - dd)} deep.`,
      'Each lap is as long as the mating piece is wide. Set a stop block and nibble the waste with a dado stack or repeated kerfs.',
      `Test in scrap first: the two laps together must equal the stock thickness, ${F.L(T)}.`,
    ] });
    o.cards.push(rabbetAfterCard(d, F));
  };

  J.mitredlap = (s, d, p, F, o) => {
    const { ws, wT, wB, OW, OH, T } = d;
    const H = rowsHelpers(d);
    const dd = p.lapDepth;
    if (dd <= 0.0625 || dd >= T - 0.0625) o.warnings.push({ level: 'error', text: `Back lap thickness must be between 1/16" and ${F.L(T - 0.0625)}.` });
    const rA = w => Math.atan2(ws, w) * DEG, sA = w => Math.atan2(w, ws) * DEG;
    o.rows.push(...H.rails((which, w) => ({ length: OW, angles: [0, 0], ends: `Square blank, ${F.A(rA(w))} miter on the face`,
      notes: `Back ${F.L(dd)} cut away for ${F.L(ws)} at each end` })));
    o.rows.push(H.stiles({ length: OH, angles: [0, 0], ends: 'Square blank',
      notes: `Front ${F.L(T - dd)} cut away to a ${F.A(sA(wT))}${Math.abs(wT - wB) > 1e-6 ? `/${F.A(sA(wB))}` : ''} miter shoulder` }));
    o.lengthNote = 'Every piece runs the full outside length.';
    o.cards.push({ title: 'Mitered laps', lines: [
      `Rails: remove the back ${F.L(dd)} for ${F.L(ws)} at each end with a square shoulder, then miter the front part at ${F.A(rA(wT))} from square.`,
      `Stiles: remove the front ${F.L(T - dd)} at each end, with the shoulder cut on the miter line (${F.A(sA(wT))} from square), leaving the back ${F.L(dd)} full length.`,
      'Cut the angled shoulder with a saw guided by a miter block, then pare the cheek flat.',
      'From the front it reads as a miter; from the back it shows the stiles running through.',
    ] });
    o.cards.push(rabbetAfterCard(d, F));
  };

  J.bridle = (s, d, p, F, o) => {
    const { ws, wT, wB, OW, OH, T } = d;
    const H = rowsHelpers(d);
    const t = p.tenonThick, cheek = (T - t) / 2;
    const thr = p.thr;
    if (t <= 0 || t >= T - 0.125) o.warnings.push({ level: 'error', text: 'The tenon is too thick for the stock. Use about a third of the thickness.' });
    else if (t < T / 4 - 1e-6 || t > T / 2 + 1e-6) o.warnings.push({ level: 'warn', text: `A bridle tenon is usually about a third of the stock thickness (${F.L(T / 3)}).` });
    const sameRails = Math.abs(wT - wB) < 1e-6;
    if (!thr) {
      o.rows.push(...H.rails(() => ({ length: OW, angles: [0, 0], ends: 'Square', notes: `Tenon ${F.L(t)} thick × ${F.L(ws)} long each end` })));
      o.rows.push(H.stiles({ length: OH, angles: [0, 0], ends: 'Square',
        notes: sameRails ? `Open slot ${F.L(t)} wide × ${F.L(wT)} deep each end` : `Open slots ${F.L(t)} wide: ${F.L(wT)} deep top, ${F.L(wB)} bottom` }));
    } else {
      o.rows.push(...H.rails(() => ({ length: OW, angles: [0, 0], ends: 'Square', notes: `Open slot ${F.L(t)} wide × ${F.L(ws)} deep each end` })));
      o.rows.push(H.stiles({ length: OH, angles: [0, 0], ends: 'Square',
        notes: sameRails ? `Tenon ${F.L(t)} thick × ${F.L(wT)} long each end` : `Tenons ${F.L(t)} thick: ${F.L(wT)} long top, ${F.L(wB)} bottom` }));
    }
    o.lengthNote = 'Every piece runs the full outside length.';
    const slotted = thr ? 'rails' : 'stiles', tenoned = thr ? 'stiles' : 'rails';
    o.cards.push({ title: 'Slots and tenons', lines: [
      `Cut the open slots in the ${slotted} first, centered in the thickness: ${F.L(t)} wide with ${F.L(cheek)} cheeks.`,
      `Then cut the cheeks off the ${tenoned} with a tenoning jig or dado stack, sneaking up on a snug fit in the slot.`,
      'Tenon length equals the width of the slotted piece. Cut it a hair long and plane the end grain flush after glue-up.',
    ] });
    o.cards.push(rabbetAfterCard(d, F));
  };

  J.mortise = (s, d, p, F, o) => {
    const { ws, wT, wB, OW, OH, T, R, D } = d;
    const H = rowsHelpers(d);
    const t = p.tenonThick, tl = p.tenonLen, so = p.shoulderOut, si = p.shoulderIn, horn = p.horn;
    const thr = p.thr;
    const mDepth = tl + 0.0625;
    const cheek = (T - t) / 2;
    if (t <= 0 || t >= T - 0.125) o.warnings.push({ level: 'error', text: 'The tenon is too thick for the stock. Use about a third of the thickness.' });
    let shoulder, tws;
    if (!thr) {
      shoulder = OW - 2 * ws;
      if (tl >= ws - 0.125) o.warnings.push({ level: 'error', text: `A ${F.L(tl)} tenon nearly goes through a ${F.L(ws)} stile. Shorten it to about ${F.L(nice(ws * 2 / 3, s.units))}.` });
      o.rows.push(...H.rails((which, w) => ({ length: shoulder + 2 * tl, shoulder, angles: [0, 0], ends: 'Tenon both ends',
        notes: `Tenons ${F.L(t)} thick × ${F.L(w - so - si)} wide × ${F.L(tl)} long` })));
      tws = [wT - so - si, wB - so - si];
      o.rows.push(H.stiles({ length: OH + 2 * horn, angles: [0, 0], ends: horn ? `Square, ${F.L(horn)} horns` : 'Square',
        notes: `Mortises ${F.L(t)} wide × ${F.L(mDepth)} deep, ${Math.abs(tws[0] - tws[1]) < 1e-6 ? `${F.L(tws[0])} long` : `${F.L(tws[0])} top, ${F.L(tws[1])} bottom`}` }));
    } else {
      shoulder = OH - wT - wB;
      if (tl >= Math.min(wT, wB) - 0.125) o.warnings.push({ level: 'error', text: `A ${F.L(tl)} tenon nearly goes through the ${F.L(Math.min(wT, wB))} rail. Shorten it.` });
      tws = [ws - so - si];
      o.rows.push(...H.rails(() => ({ length: OW + 2 * horn, angles: [0, 0], ends: horn ? `Square, ${F.L(horn)} horns` : 'Square',
        notes: `Mortises ${F.L(t)} wide × ${F.L(mDepth)} deep × ${F.L(tws[0])} long` })));
      o.rows.push(H.stiles({ length: shoulder + 2 * tl, shoulder, angles: [0, 0], ends: 'Tenon both ends',
        notes: `Tenons ${F.L(t)} thick × ${F.L(tws[0])} wide × ${F.L(tl)} long` }));
    }
    if (Math.min(...tws) < 0.375) o.warnings.push({ level: 'error', text: 'The tenons are too narrow once the shoulders are taken off. Reduce the shoulders or widen the members.' });
    if (R > 0 && D > cheek + 1e-6 && si < R - 1e-6) o.warnings.push({ level: 'warn', text: `Routing the rabbet will cut into the tenons. Make the inner shoulder at least ${F.L(R)}.` });
    o.lengthNote = 'Tenoned pieces include both tenons.';
    const tm = thr ? 'rails' : 'stiles', tn = thr ? 'stiles' : 'rails';
    const lines = [
      `Shoulder to shoulder on the ${tn}: ${F.L(shoulder)}.`,
      `Lay out each mortise ${F.L(horn + so)} from the end of the ${tm.slice(0, -1)}, centered in the thickness (${F.L(cheek)} walls).`,
      `Chop or drill the mortises ${F.L(mDepth)} deep (1/16" deeper than the tenon for glue), then saw the tenons to fit them.`,
      `Tenon shoulders: ${F.L(so)} on the outer edge so the mortise doesn't break out the end, ${F.L(si)} on the inner edge.`,
    ];
    if (horn > 0) lines.push(`The ${tm} are cut ${F.L(horn)} long at each end (horns) so the mortise walls don't split. Saw them flush after glue-up.`);
    o.cards.push({ title: 'Mortises and tenons', lines });
    o.cards.push(rabbetAfterCard(d, F));
  };

  function grooveFrame(s, d, p, F, o, depth, gw, kind) {
    const { ws, wT, wB, OW, OH, T } = d;
    const H = rowsHelpers(d);
    const thr = p.thr;
    if (gw >= T - 0.1875) o.warnings.push({ level: 'error', text: 'The groove is too wide for the stock. Keep it near a third of the thickness.' });
    if (depth >= Math.min(ws, wT, wB) / 2) o.warnings.push({ level: 'warn', text: 'The groove goes more than halfway into the narrowest member. Make it shallower.' });
    const tongue = kind === 'cope' ? 'Coped ends' : 'Tongues';
    let shoulder;
    if (!thr) {
      shoulder = OW - 2 * ws;
      o.rows.push(...H.rails(() => ({ length: shoulder + 2 * depth, shoulder, angles: [0, 0], ends: kind === 'cope' ? 'Coped both ends' : 'Tongue both ends',
        notes: `${tongue} ${F.L(gw)} thick × ${F.L(depth)} long; groove inside edge` })));
      o.rows.push(H.stiles({ length: OH, angles: [0, 0], ends: 'Square', notes: `Groove ${F.L(gw)} × ${F.L(depth)} along the inside edge` }));
    } else {
      shoulder = OH - wT - wB;
      o.rows.push(...H.rails(() => ({ length: OW, angles: [0, 0], ends: 'Square', notes: `Groove ${F.L(gw)} × ${F.L(depth)} along the inside edge` })));
      o.rows.push(H.stiles({ length: shoulder + 2 * depth, shoulder, angles: [0, 0], ends: kind === 'cope' ? 'Coped both ends' : 'Tongue both ends',
        notes: `${tongue} ${F.L(gw)} thick × ${F.L(depth)} long; groove inside edge` }));
    }
    o.lengthNote = `${thr ? 'Stiles' : 'Rails'} include ${F.L(depth)} at each end that goes into the groove.`;
    return shoulder;
  }

  J.tongue = (s, d, p, F, o) => {
    const gw = p.grooveW, gd = p.grooveD, T = d.T;
    const shoulder = grooveFrame(s, d, p, F, o, gd, gw, 'tongue');
    const tn = p.thr ? 'stiles' : 'rails';
    o.cards.push({ title: 'Groove and tongues', lines: [
      `Groove every inside edge ${F.L(gw)} wide × ${F.L(gd)} deep, centered (${F.L((T - gw) / 2)} from each face). Flip the piece between passes to center it exactly.`,
      `Cut tongues on the ends of the ${tn} with the same fence setting: ${F.L(gw)} thick × ${F.L(gd)} long. Shoulder to shoulder: ${F.L(shoulder)}.`,
      'The groove runs out through the ends of the through pieces; it is hidden once the frame is glued.',
      grooveShowCheck(d, gw, gd, F, o),
    ] });
    o.cards.push(rabbetAfterCard(d, F));
  };

  J.cope = (s, d, p, F, o) => {
    const cd = p.copeD, gw = p.grooveW;
    const shoulder = grooveFrame(s, d, p, F, o, cd, gw, 'cope');
    const tn = p.thr ? 'stiles' : 'rails';
    o.cards.push({ title: 'Cope and stick', lines: [
      `Cope the ends of the ${tn} first, face down, with a backer block behind them to stop tear-out. Shoulder to shoulder: ${F.L(shoulder)}.`,
      'Then run the stick (profile) bit along every inside edge.',
      `This cut list assumes a cope depth of ${F.L(cd)}. Check yours on a test piece by measuring from the end to the shoulder; most sets cut 3/8" (9.5 mm).`,
      'A glass-door set cuts a rabbet instead of a groove; otherwise rout the rabbet after glue-up.',
      grooveShowCheck(d, gw, cd, F, o),
    ] });
    o.cards.push(rabbetAfterCard(d, F));
  };

  J.butt = (s, d, p, F, o) => {
    const { ws, wT, wB, OW, OH, T, R } = d;
    const H = rowsHelpers(d);
    const thr = p.thr;
    if (!thr) {
      o.rows.push(...H.rails(() => ({ length: OW - 2 * ws, angles: [0, 0], ends: 'Square' })));
      o.rows.push(H.stiles({ length: OH, angles: [0, 0], ends: 'Square' }));
    } else {
      o.rows.push(...H.rails(() => ({ length: OW, angles: [0, 0], ends: 'Square' })));
      o.rows.push(H.stiles({ length: OH - wT - wB, angles: [0, 0], ends: 'Square' }));
    }
    o.lengthNote = thr ? 'Rails run the full width; stiles fit between them.' : 'Stiles run the full height; rails fit between them.';
    const joinW = thr ? [ws, ws] : [wT, wB];         // top joints, bottom joints
    const plans = joinW.map(w => fastenerPlan(d, p, w));
    const wThrough = thr ? Math.min(wT, wB) : ws;
    const tn = thr ? 'rails' : 'stiles', jn = thr ? 'stiles' : 'rails';
    const q = s.qty;
    const perJoint = plans[0].count === plans[1].count ? `${plural(plans[0].count, 'per joint', 'per joint')}`.replace(/^1 per joint$/, 'one per joint') : '';
    const posText = pl => pl.positions.map(F.L).join(' and ');
    const total = (plans[0].count + plans[1].count) * 2;
    if (p.buttReinf === 'dowels') {
      const hd = p.dowelLen / 2 + 0.0625;
      if (hd >= wThrough - 0.125) o.warnings.push({ level: 'warn', text: `Dowel holes ${F.L(hd)} deep nearly go through the ${F.L(wThrough)} ${tn}. Use shorter dowels.` });
      const cnt = plans[0].count === plans[1].count ? `${plans[0].count} per joint` : `${plans[0].count} per joint at the top, ${plans[1].count} at the bottom`;
      o.cards.push({ title: 'Dowels', lines: [
        `${F.L(p.dowelDia)} × ${F.L(p.dowelLen)} dowels, ${cnt}.`,
        `Drill ${F.L(hd)} deep into the ends of the ${jn} and the edges of the ${tn}, centered ${F.L(T / 2)} from the face.`,
        `Hole centers from the outer edge: ${posText(plans[0])}${plans[1].positions.join() !== plans[0].positions.join() ? ` at the top, ${posText(plans[1])} at the bottom` : ''}.`,
        'A self-centering doweling jig keeps the holes aligned on both pieces.',
      ] });
      o.materials.push({ name: `Dowels ${F.L(p.dowelDia)} × ${F.L(p.dowelLen)}`, qty: total * q, size: '', note: 'fluted' });
    } else if (p.buttReinf === 'biscuits') {
      const bad = plans.some(pl => !pl.biscuit);
      if (bad) o.warnings.push({ level: 'warn', text: `The ${jn} are too narrow for biscuits${R ? ' once the rabbet is allowed for' : ''}. Use dowels, a loose tenon or pocket screws.` });
      else {
        const names = [...new Set(plans.map(pl => pl.biscuit.name))].join(' / ');
        o.cards.push({ title: 'Biscuits', lines: [
          `One ${names} biscuit per joint, slot centered ${F.L(plans[0].band / 2)} from the outer edge.`,
          `Set the slot ${F.L(T - plans[0].z)} down from the front face${R ? ' so the rabbet misses it' : ''}.`,
          'Biscuits mostly align the joint; the long-grain to end-grain glue line is still the weak point.',
        ] });
        o.materials.push({ name: `Biscuits, ${names}`, qty: 4 * q, size: '', note: '' });
      }
    } else if (p.buttReinf === 'pocket') {
      const sc = plans[0].screw;
      o.cards.push({ title: 'Pocket screws', lines: [
        `Drill pocket holes in the back of the ${jn} near each end, set for ${F.L(T)} stock: ${plans[0].count === plans[1].count ? `${plans[0].count} per joint` : `${plans[0].count} at the top, ${plans[1].count} at the bottom`}.`,
        `Keep the holes within ${F.L(plans[0].band)} of the outer edge so the rabbet misses them. Centers: ${posText(plans[0])}.`,
        `Screws: ${F.L(sc)} pocket screws, coarse thread for softwood, fine for hardwood. Clamp flat while driving.`,
        'The holes show on the back. Plug them if the back will be seen.',
      ] });
      o.materials.push({ name: `Pocket screws ${F.L(sc)}`, qty: total * q, size: '', note: '' });
    } else {
      const dm = plans[0].domino;
      o.cards.push({ title: 'Loose tenons', lines: [
        `${dm.name} loose tenons (Domino), ${plans[0].count === plans[1].count ? `${plans[0].count} per joint` : `${plans[0].count} at the top, ${plans[1].count} at the bottom`}.`,
        `Mortise ${F.L(dm.len / 2 + 0.04)} deep into each piece, centered ${F.L(T / 2)} from the face; ${posText(plans[0])} from the outer edge.`,
        'Cut one side at the tight width setting and the other a size wider for adjustment.',
      ] });
      o.materials.push({ name: `Loose tenons ${dm.name}`, qty: total * q, size: '', note: '' });
    }
    o.cards.push(rabbetAfterCard(d, F));
    void perJoint;
  };

  /* ---------- Materials, steps ---------- */

  function addMaterials(s, d, p, F, o) {
    const q = s.qty;
    const glass = `${F.L(d.GW)} × ${F.L(d.GH)}`;
    const base = [
      { name: 'Glass or acrylic', qty: q, size: glass, note: `rabbet opening ${F.L(d.RW)} × ${F.L(d.RH)} less ${F.L(d.c)}` },
    ];
    if (s.mat.on) base.push({ name: 'Mat board', qty: q, size: glass, note: `window ${F.L(d.MW)} × ${F.L(d.MH)}, borders ${F.L(s.mat.side)} sides, ${F.L(s.mat.top)} top, ${F.L(s.mat.bottom)} bottom` });
    base.push({ name: 'Backing board', qty: q, size: glass, note: 'foam board, hardboard or acid-free board' });
    const pts = 2 * Math.max(2, Math.ceil(d.RW / 6)) + 2 * Math.max(2, Math.ceil(d.RH / 6));
    base.push({ name: 'Glazier or flexible points', qty: pts * q, size: '', note: 'about every 6"' });
    base.push({ name: 'D-rings', qty: 2 * q, size: '', note: `${F.L(d.OH / 3)} down from the top, on the stiles` });
    o.materials.unshift(...base);
  }

  function buildSteps(s, d, p, F, o) {
    const st = [];
    const { ws, wT, wB, T, R, D } = d;
    const allSame = Math.abs(wT - ws) < 1e-6 && Math.abs(wB - ws) < 1e-6;
    st.push(`Mill the stock flat and square to ${F.L(T)} thick, then rip it to width: ${allSame ? F.L(ws) : `stiles ${F.L(ws)}, top rail ${F.L(wT)}, bottom rail ${F.L(wB)}`}.`);
    const j = s.joint;
    if (j === 'miter' || j === 'miterspline') {
      if (R > 0) st.push(`Cut the ${F.L(R)} × ${F.L(D)} rabbet along one edge of each strip before cutting the pieces, in two passes on the table saw or with a rabbeting bit.`);
      st.push(s.stock.grain ? 'Cut the pieces in order around the frame (top, side, bottom, side) from one strip so the grain wraps the corners. Miter one end, mark the long point, then cut the other end.' : 'Miter one end of each piece, mark its long point, then cut the other end.');
      st.push('Dry-fit in a band clamp. Fix any gap by trimming on a shooting board or miter sled; make both pieces of each pair identical.');
      if (p.miterReinf === 'keys') st.push(`Glue up in a band clamp. Once cured, cut the spline slots on a 45° cradle sled (blade ${F.L(p.keyLeg / Math.SQRT2)} high), glue in the splines and trim them flush.`);
      else if (p.miterReinf === 'vnails') st.push('Glue up in a band clamp and drive the V-nails from the back while it is clamped.');
      else if (p.miterReinf === 'biscuits') st.push('Cut a biscuit slot in each miter face, then glue up with the biscuits in a band clamp.');
      else st.push('Size the end grain with thin glue, let it tack, then glue up in a band clamp.');
    } else {
      st.push('Cut every piece to length with a stop block so matching pieces are identical.');
      if (j === 'halflap') st.push(`Cut the laps with a dado stack or repeated kerfs: ${F.L(p.lapDepth)} deep from the back of the ${p.thr ? 'rails' : 'stiles'}, ${F.L(T - p.lapDepth)} deep from the front of the ${p.thr ? 'stiles' : 'rails'}.`);
      if (j === 'mitredlap') st.push(`Cut the rails' back laps (${F.L(p.lapDepth)} deep) and miter their fronts, then saw the stiles' front laps to an angled shoulder. Pare until the miter closes.`);
      if (j === 'bridle') st.push(`Cut the slots (${F.L(p.tenonThick)} wide), then cut the tenons to fit them.`);
      if (j === 'mortise') st.push(`Cut the mortises (${F.L(p.tenonThick)} wide × ${F.L(p.tenonLen + 0.0625)} deep), then saw and pare the tenons to fit.`);
      if (j === 'tongue') st.push(`Groove every inside edge (${F.L(p.grooveW)} × ${F.L(p.grooveD)}), then cut the tongues with the same fence setting.`);
      if (j === 'cope') st.push('Cope the rail ends with a backer block, then stick every inside edge.');
      if (j === 'butt') {
        const label = { dowels: 'Drill the dowel holes with a doweling jig.', biscuits: 'Cut the biscuit slots.', pocket: 'Drill the pocket holes in the back of the joining pieces.', domino: 'Cut the loose-tenon mortises.' }[p.buttReinf];
        st.push(label);
      }
      st.push(`Dry-fit, then glue up. Check that the diagonals match (${F.L(d.diag)} corner to corner on the outside).`);
      if (R > 0) st.push(`Rout the ${F.L(R)} × ${F.L(D)} rabbet around the back and square the corners with a chisel.`);
    }
    st.push('Sand and finish.');
    st.push(`Fit the glass, ${s.mat.on ? 'mat, ' : ''}artwork and backer, and hold them with points. Add D-rings and wire ${F.L(d.OH / 3)} down from the top.`);
    o.steps = st;
  }

  /* ---------- Stock layout ---------- */

  function frameCuts(rows) {
    const top = rows.find(r => r.key === 'top' || r.key === 'rails');
    const bot = rows.find(r => r.key === 'bottom' || r.key === 'rails');
    const st = rows.find(r => r.key === 'stiles');
    if (!top || !bot || !st) return [];
    const c = (label, r, flip) => ({ label, length: r.length, width: r.width,
      angles: flip ? [(r.angles || [0, 0])[1], (r.angles || [0, 0])[0]] : (r.angles || [0, 0]).slice() });
    return [c('Top', top), c('Side', st), c('Bottom', bot), c('Side', st, true)];
  }

  function stockItems(cuts, s) {
    const k = Math.max(0, s.stock.kerf), items = [];
    for (let f = 0; f < s.qty; f++) {
      cuts.forEach((c, i) => {
        const a = Math.min(60, Math.max(...c.angles.map(Math.abs)));
        items.push(Object.assign({}, c, { frame: f, seq: i, allow: k / Math.cos(a / DEG) }));
      });
    }
    return items;
  }

  /** Packs same-width pieces end to end into lengths of `usable` (after `trim`). Returns the filled lengths. */
  function packLength(items, usable, trim, grain) {
    const lanes = [];
    const fresh = () => { const b = { cuts: [], used: 0, over: false }; lanes.push(b); return b; };
    const fits = (b, it) => !b.over && b.used + it.length <= usable + 1e-9;
    const put = (b, it) => { b.cuts.push(Object.assign({}, it, { start: trim + b.used })); b.used += it.length + it.allow; };
    const overflow = it => { const b = fresh(); b.over = true; put(b, it); };
    if (grain) {
      let cur = null;
      const frames = [...new Set(items.map(it => it.frame))];
      for (const f of frames) {
        const seq = items.filter(it => it.frame === f);
        const need = seq.reduce((a, it) => a + it.length + it.allow, 0) - (seq.length ? seq[seq.length - 1].allow : 0);
        if (cur && cur.used + need > usable + 1e-9 && need <= usable + 1e-9) cur = null;
        for (const it of seq) {
          if (it.length > usable + 1e-9) { overflow(it); continue; }
          if (!cur || !fits(cur, it)) cur = fresh();
          put(cur, it);
        }
      }
    } else {
      const sorted = items.slice().sort((a, b) => b.length - a.length);
      for (const it of sorted) {
        if (it.length > usable + 1e-9) { overflow(it); continue; }
        put(lanes.find(b => fits(b, it)) || fresh(), it);
      }
    }
    for (const b of lanes) b.remainder = b.over ? 0 : Math.max(0, usable - b.used);
    return lanes;
  }

  function byWidth(items) {
    const groups = [];
    for (const it of items) {
      let g = groups.find(x => Math.abs(x.width - it.width) < 1e-6);
      if (!g) groups.push(g = { width: it.width, items: [] });
      g.items.push(it);
    }
    return groups;
  }

  function layoutStock(cuts, s, d) {
    const L = s.stock.length, k = Math.max(0, s.stock.kerf), trim = Math.max(0, s.stock.trim);
    const usable = L - trim;
    const groups = byWidth(stockItems(cuts, s)).map(g => {
      const boards = packLength(g.items, usable, trim, s.stock.grain);
      const linear = g.items.reduce((a, it) => a + it.length, 0);
      return { width: g.width, thick: d.T, items: g.items, boards, linear, boardFeet: boards.length * d.T * g.width * L / 144 };
    });
    const totalBoards = groups.reduce((a, g) => a + g.boards.length, 0);
    const linear = groups.reduce((a, g) => a + g.linear, 0);
    const maxW = Math.max(d.ws, d.wT, d.wB);
    return {
      mode: 'strips', groups, boardLength: L, usable, kerf: k, trim, totalBoards, linear,
      waste: totalBoards ? Math.max(0, 1 - linear / (totalBoards * L)) : 0,
      over: groups.some(g => g.boards.some(b => b.over)),
      moldingRule: s.qty * (2 * (d.OW + d.OH) + 8 * maxW),
    };
  }

  /* ---------- Boards: ripping strips from wider stock ---------- */

  // Standard surfaced lumber: actual widths, and the thicknesses it comes in.
  const LUMBER_IN = { widths: [[2, 1.5], [3, 2.5], [4, 3.5], [5, 4.5], [6, 5.5], [8, 7.25], [10, 9.25], [12, 11.25]],
    thick: [[0.75, '1×'], [1, '5/4×'], [1.5, '2×']] };
  const LUMBER_MM = { widths: [44, 69, 94, 119, 144, 169, 194, 219], thick: [18, 25, 32, 44] };

  /** The standard boards that are at least `T` thick (the thinnest such thickness), as {name, w, t}. */
  function lumberOptions(T, units) {
    if (units === 'mm') {
      const t = LUMBER_MM.thick.find(x => x / MM >= T - 1e-6) || LUMBER_MM.thick[LUMBER_MM.thick.length - 1];
      return LUMBER_MM.widths.map(w => ({ name: `${t} × ${w} mm`, w: w / MM, t: t / MM }));
    }
    const t = LUMBER_IN.thick.find(x => x[0] >= T - 1e-6) || LUMBER_IN.thick[LUMBER_IN.thick.length - 1];
    return LUMBER_IN.widths.map(([nom, w]) => ({ name: `${t[1]}${nom}`, w, t: t[0] }));
  }

  /** Width taken by strips ripped side by side from one board: each rip after the first costs a kerf. */
  function ripWidth(widths, k) { return widths.reduce((a, w) => a + w, 0) + Math.max(0, widths.length - 1) * k; }

  /**
   * Chooses boards from `opts` to rip the strips in `widths` from, using the least total board width
   * (every board is the same length, so that is the least wood), then the fewest boards.
   * Exact for the usual case of up to three strip widths; greedy when the search would be large.
   */
  function chooseBoards(widths, opts, k) {
    if (!widths.length) return { boards: [], cost: 0 };
    const kinds = [...new Set(widths.map(w => +w.toFixed(6)))].sort((a, b) => b - a);
    const need = kinds.map(w => widths.filter(x => Math.abs(x - w) < 1e-6).length);
    if (kinds[0] > opts[opts.length - 1].w + 1e-9) return null;
    const patterns = [];
    for (const o of opts) {
      const rec = (i, cnt) => {
        if (i === kinds.length) {
          if (cnt.some(c => c > 0)) patterns.push({ o, cnt: cnt.slice() });
          return;
        }
        for (let c = 0; c <= need[i]; c++) {
          cnt[i] = c;
          const list = [];
          cnt.forEach((n, j) => { for (let m = 0; m < n && j <= i; m++) list.push(kinds[j]); });
          if (ripWidth(list, k) > o.w + 1e-9) break;
          rec(i + 1, cnt);
        }
        cnt[i] = 0;
      };
      rec(0, kinds.map(() => 0));
    }
    const space = need.reduce((a, n) => a * (n + 1), 1);
    const pick = (cnt, o) => { const out = []; cnt.forEach((n, j) => { for (let m = 0; m < n; m++) out.push(kinds[j]); }); return { opt: o, strips: out }; };
    if (space * patterns.length <= 400000) {
      const memo = new Map();
      const best = rem => {
        if (rem.every(n => n === 0)) return { cost: 0, list: [] };
        const key = rem.join(',');
        if (memo.has(key)) return memo.get(key);
        let res = { cost: Infinity, list: null };
        for (const p of patterns) {
          if (p.cnt.some((c, j) => c > rem[j])) continue;
          // Only fill the first remaining kind's strips here, so each set of boards is counted once.
          const first = rem.findIndex(n => n > 0);
          if (p.cnt[first] === 0) continue;
          const sub = best(rem.map((n, j) => n - p.cnt[j]));
          const cost = sub.cost + p.o.w + 0.001;
          if (cost < res.cost - 1e-9) res = { cost, list: [p].concat(sub.list) };
        }
        memo.set(key, res);
        return res;
      };
      const r = best(need);
      if (!r.list) return null;
      return { boards: r.list.map(p => pick(p.cnt, p.o)), cost: r.cost };
    }
    // Greedy: each board is the pattern that uses the largest share of its width, widest strips first.
    const rem = need.slice(), boards = [];
    let cost = 0;
    while (rem.some(n => n > 0)) {
      let bestP = null, bestU = -1;
      for (const p of patterns) {
        if (p.cnt.some((c, j) => c > rem[j])) continue;
        const used = p.cnt.reduce((a, c, j) => a + c * kinds[j], 0);
        const u = used / p.o.w + used * 1e-4;
        if (u > bestU) { bestU = u; bestP = p; }
      }
      if (!bestP) return null;
      bestP.cnt.forEach((c, j) => { rem[j] -= c; });
      boards.push(pick(bestP.cnt, bestP.o));
      cost += bestP.o.w;
    }
    return { boards, cost };
  }

  /** Puts filled strips onto chosen boards, matching each strip's width. */
  function assignStrips(choice, lanes, L, k) {
    const pool = lanes.slice();
    return choice.boards.map(b => {
      const strips = b.strips.map(w => {
        const i = pool.findIndex(l => Math.abs(l.width - w) < 1e-6);
        return pool.splice(i, 1)[0];
      });
      return { src: 'buy', name: b.opt.name, w: b.opt.w, t: b.opt.t, l: L, lanes: strips, ripLeft: Math.max(0, b.opt.w - ripWidth(b.strips, k)) };
    });
  }

  /** The cheapest set of standard boards of length `L` for these pieces, plus single-size alternatives. */
  function planBuy(items, s, d, L) {
    const k = Math.max(0, s.stock.kerf), trim = Math.max(0, s.stock.trim), usable = L - trim;
    const lanes = [];
    for (const g of byWidth(items)) for (const ln of packLength(g.items, usable, trim, s.stock.grain)) lanes.push(Object.assign(ln, { width: g.width }));
    const opts = lumberOptions(d.T, s.units);
    const parts = items.reduce((a, it) => a + it.length * it.width, 0);
    const widths = lanes.map(l => l.width);
    const summarize = choice => {
      if (!choice) return null;
      const area = choice.boards.reduce((a, b) => a + b.opt.w, 0) * L;
      const counts = [];
      for (const b of choice.boards) { const c = counts.find(x => x.name === b.opt.name); if (c) c.n++; else counts.push({ name: b.opt.name, w: b.opt.w, t: b.opt.t, n: 1 }); }
      return { count: choice.boards.length, counts, waste: area ? Math.max(0, 1 - parts / area) : 0, boards: assignStrips(choice, lanes, L, k) };
    };
    const best = summarize(chooseBoards(widths, opts, k));
    const singles = [];
    for (const o of opts) {
      const r = summarize(chooseBoards(widths, [o], k));
      if (r) singles.push(r);
    }
    singles.sort((a, b) => a.waste - b.waste || a.count - b.count);
    return { length: L, thick: opts[0].t, over: lanes.some(l => l.over), best, singles: singles.slice(0, 4) };
  }

  /** Lays the pieces out on the boards listed (smallest first), then on boards to buy if allowed. */
  function layoutBoards(cuts, s, d) {
    const k = Math.max(0, s.stock.kerf), trim = Math.max(0, s.stock.trim);
    let pool = stockItems(cuts, s);
    const parts = pool.reduce((a, it) => a + it.length * it.width, 0);
    const have = [], thin = [];
    s.stock.boards.forEach((b, bi) => { for (let i = 0; i < b.n; i++) (b.t < d.T - 1e-6 ? thin : have).push({ b, bi, i }); });
    have.sort((x, y) => x.b.w * x.b.l - y.b.w * y.b.l);
    const boards = [];
    for (const h of have) {
      const { w: B, l } = h.b, usable = l - trim;
      const lanes = [];
      let left = B;
      for (;;) {
        let best = null;
        for (const g of byWidth(pool)) {
          if (g.width + (lanes.length ? k : 0) > left + 1e-9) continue;
          const lane = packLength(g.items, usable, trim, s.stock.grain).filter(x => !x.over).sort((a, b) => b.used - a.used)[0];
          if (!lane) continue;
          const score = lane.cuts.reduce((a, c) => a + c.length, 0) * g.width;
          if (!best || score > best.score) best = { score, lane: Object.assign(lane, { width: g.width }) };
        }
        if (!best) break;
        const used = new Set(best.lane.cuts.map(c => c.frame + ':' + c.seq));
        pool = pool.filter(it => !used.has(it.frame + ':' + it.seq));
        left -= best.lane.width + (lanes.length ? k : 0);
        lanes.push(best.lane);
      }
      if (lanes.length) boards.push({ src: 'have', name: `Board ${h.bi + 1}${h.b.n > 1 ? String.fromCharCode(97 + h.i) : ''}`, w: B, t: h.b.t, l, lanes, ripLeft: Math.max(0, left) });
    }
    let buy = null;
    if (pool.length && s.stock.buy) {
      buy = planBuy(pool, s, d, s.stock.length);
      if (buy.best) { boards.push(...buy.best.boards); pool = []; }
    }
    const area = boards.reduce((a, b) => a + b.w * b.l, 0);
    return {
      mode: 'boards', boards, unplaced: pool, thin: thin.length, kerf: k, trim, boardLength: s.stock.length,
      totalBoards: boards.length, buyCount: boards.filter(b => b.src === 'buy').length,
      over: !!(buy && buy.over), waste: area ? Math.max(0, 1 - parts / area) : 0, buy,
    };
  }

  /* ---------- Entry point ---------- */

  function compute(input) {
    const s = normalizeState(input);
    const F = makeFmt(s);
    const d = solve(s, F);
    const p = resolveParams(s, d);
    const out = { state: s, dims: d, params: p, joint: JOINT_BY_ID[s.joint], fmt: F,
      rows: [], cards: [], materials: [], steps: [], warnings: d.warnings.slice(), cuts: [], layout: null, lengthNote: '' };
    out.ok = !out.warnings.some(w => w.level === 'error');
    if (!out.ok) return out;
    J[s.joint](s, d, p, F, out);
    addMaterials(s, d, p, F, out);
    buildSteps(s, d, p, F, out);
    for (const r of out.rows) r.qtyTotal = r.qty * s.qty;
    out.cuts = frameCuts(out.rows);
    const src = s.stock.source;
    out.layout = src === 'boards' ? layoutBoards(out.cuts, s, d) : layoutStock(out.cuts, s, d);
    const lay = out.layout;
    if (lay.over) out.warnings.push({ level: 'warn', text: `Some pieces are longer than ${src === 'molding' ? 'your' : 'the'} ${F.L(s.stock.length)} ${src === 'molding' ? 'molding' : 'boards'}. Use longer stock or split the frame.` });
    if (src === 'boards') {
      if (lay.thin) out.warnings.push({ level: 'warn', text: `${plural(lay.thin, 'board')} on your list ${lay.thin === 1 ? 'is' : 'are'} thinner than the ${F.L(d.T)} frame stock and ${lay.thin === 1 ? 'was' : 'were'} left out.` });
      if (lay.unplaced.length) out.warnings.push({ level: 'warn', text: s.stock.buy
        ? `${plural(lay.unplaced.length, 'piece')} won't fit on any standard board. Glue up wider stock for ${lay.unplaced.length === 1 ? 'it' : 'them'}.`
        : `${plural(lay.unplaced.length, 'piece')} don't fit on your boards: ${lay.unplaced.map(it => `${it.label.toLowerCase()} ${F.L(it.length)}`).join(', ')}. Add boards or let it buy more.` });
      if (s.stock.boards.some(b => b.t > d.T + 1e-6)) out.notes = [`Plane the thicker boards down to ${F.L(d.T)}.`];
    }
    if (src === 'molding' && !['miter', 'miterspline'].includes(s.joint)) out.warnings.push({ level: 'warn', text: 'Molding is normally mitered: its profile won\'t meet cleanly with this joint.' });
    // The cheapest set of standard boards for the whole job, when the frame is cut from boards or strips.
    out.suggest = s.stock.suggest && src !== 'molding' ? planBuy(stockItems(out.cuts, s), s, d, s.stock.length) : null;
    out.ok = !out.warnings.some(w => w.level === 'error');
    return out;
  }

  return {
    MM, DEG, JOINTS, JOINT_BY_ID, BISCUITS, DOMINOS,
    defaultState, normalizeState, compute, solve, resolveParams,
    lumberOptions, chooseBoards, planBuy, ripWidth,
    fmtLen, fmtAngle, parseLen, makeFmt, nice,
    fastenerPlan, bandFor, spread,
  };
});
