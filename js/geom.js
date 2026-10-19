/* Framewright geometry: convex solids, plane clipping (enough CSG to cut joints)
   and the 3D model of a frame for each joint type.
   World axes: x to the right, y up, z toward the viewer. The frame's back is z = 0,
   its front z = T, and the outside corner at bottom left is the origin. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./core.js'));
  else root.FWGeom = factory(root.FWCore);
})(typeof self !== 'undefined' ? self : this, function (Core) {
  'use strict';

  const E = 1e-7;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const neg = a => [-a[0], -a[1], -a[2]];
  const near = (a, b, t) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) <= t;

  function newell(f) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      x += (a[1] - b[1]) * (a[2] + b[2]);
      y += (a[2] - b[2]) * (a[0] + b[0]);
      z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [x, y, z];
  }
  function faceArea(f) { const n = newell(f); return Math.hypot(n[0], n[1], n[2]) / 2; }
  function centroid(P) {
    let x = 0, y = 0, z = 0, n = 0;
    for (const f of P.faces) for (const p of f) { x += p[0]; y += p[1]; z += p[2]; n++; }
    return [x / n, y / n, z / n];
  }
  function bbox(P) {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const f of P.faces) for (const p of f) {
      for (let i = 0; i < 3; i++) { if (p[i] < b[i]) b[i] = p[i]; if (p[i] > b[i + 3]) b[i + 3] = p[i]; }
    }
    return b;
  }
  function overlap(a, b) {
    return a[0] < b[3] - E && b[0] < a[3] - E && a[1] < b[4] - E && b[1] < a[4] - E && a[2] < b[5] - E && b[2] < a[5] - E;
  }
  function volume(P) {
    const c = centroid(P);
    let v = 0;
    for (const f of P.faces) {
      const nn = newell(f);
      const l = Math.hypot(nn[0], nn[1], nn[2]);
      if (l < 1e-12) continue;
      v += (l / 2) * Math.abs(dot([nn[0] / l, nn[1] / l, nn[2] / l], sub(f[0], c))) / 3;
    }
    return v;
  }

  function dedupeLoop(pts) {
    const out = [];
    for (const p of pts) if (!out.length || !near(p, out[out.length - 1], 1e-7)) out.push(p);
    while (out.length > 1 && near(out[0], out[out.length - 1], 1e-7)) out.pop();
    return out;
  }
  function uniq(pts) {
    const out = [];
    for (const p of pts) if (!out.some(q => near(p, q, 1e-6))) out.push(p);
    return out;
  }
  function orderOnPlane(pts, n) {
    if (pts.length < 3) return pts;
    const c = [0, 0, 0];
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }
    c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length;
    const u = norm(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const v = cross(n, u);
    return pts.map(p => { const d = sub(p, c); return { p, a: Math.atan2(dot(d, v), dot(d, u)) }; })
      .sort((a, b) => a.a - b.a).map(o => o.p);
  }

  /** Keep the part of convex solid P where n·p <= d. Returns P itself, a new solid, or null. */
  function clip(P, n, d) {
    let out = false, inn = false;
    for (const f of P.faces) for (const p of f) {
      const s = dot(n, p) - d;
      if (s > E) out = true; else if (s < -E) inn = true;
    }
    if (!out) return P;
    if (!inn) return null;
    const faces = [], cap = [];
    for (const f of P.faces) {
      const res = [];
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        const sa = dot(n, a) - d, sb = dot(n, b) - d;
        if (sa <= E) { res.push(a); if (sa >= -E) cap.push(a); }
        if ((sa < -E && sb > E) || (sa > E && sb < -E)) {
          const t = sa / (sa - sb);
          const q = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
          res.push(q); cap.push(q);
        }
      }
      const r = dedupeLoop(res);
      if (r.length >= 3 && faceArea(r) > 1e-10) faces.push(r);
    }
    const c = orderOnPlane(uniq(cap), n);
    if (c.length >= 3 && faceArea(c) > 1e-10) faces.push(c);
    if (faces.length < 4) return null;
    const Q = Object.assign({}, P, { faces });
    delete Q._planes;
    return volume(Q) > 1e-9 ? Q : null;
  }

  function planesOf(C) {
    const c = centroid(C);
    const out = [];
    for (const f of C.faces) {
      const nn = newell(f);
      if (Math.hypot(nn[0], nn[1], nn[2]) < 1e-12) continue;
      let n = norm(nn), d = dot(n, f[0]);
      if (dot(n, c) > d) { n = neg(n); d = -d; }
      out.push({ n, d });
    }
    return out;
  }

  /** P minus convex cutter C, as a list of convex pieces. */
  function subtract(P, C) {
    if (!overlap(bbox(P), C._bb || (C._bb = bbox(C)))) return [P];
    const planes = C._planes || (C._planes = planesOf(C));
    const out = [];
    let rest = P;
    for (const pl of planes) {
      const o = clip(rest, neg(pl.n), -pl.d);
      if (o) out.push(o);
      rest = clip(rest, pl.n, pl.d);
      if (!rest) return out;
    }
    return out;
  }

  function translate(P, v) {
    return Object.assign({}, P, { faces: P.faces.map(f => f.map(p => [p[0] + v[0], p[1] + v[1], p[2] + v[2]])) });
  }

  /* ---------- Solid constructors ---------- */

  function fromCaps(bot, top) {
    const faces = [bot, top];
    for (let i = 0; i < bot.length; i++) {
      const j = (i + 1) % bot.length;
      faces.push([bot[i], bot[j], top[j], top[i]]);
    }
    return { faces };
  }
  function clean2(pts) {
    const out = [];
    for (const p of pts) if (!out.length || Math.abs(p[0] - out[out.length - 1][0]) + Math.abs(p[1] - out[out.length - 1][1]) > 1e-9) out.push(p);
    while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) + Math.abs(out[0][1] - out[out.length - 1][1]) <= 1e-9) out.pop();
    return out;
  }
  function box(x0, x1, y0, y1, z0, z1) {
    return prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1, 'z');
  }
  /** Extrude a convex 2D polygon from a0 to a1 along an axis. Points are (x,y) for 'z', (y,z) for 'x', (x,z) for 'y'. */
  function prism(pts, a0, a1, axis) {
    const map = axis === 'x' ? (u, v, a) => [a, u, v] : axis === 'y' ? (u, v, a) => [u, a, v] : (u, v, a) => [u, v, a];
    const q = clean2(pts);
    return fromCaps(q.map(p => map(p[0], p[1], a0)), q.map(p => map(p[0], p[1], a1)));
  }
  /** Extrude a 2D polygon (in basis e1, e2 at origin o) along dir from t0 to t1. */
  function prismDir(pts, o, e1, e2, dir, t0, t1) {
    const P = (u, v, t) => [o[0] + e1[0] * u + e2[0] * v + dir[0] * t, o[1] + e1[1] * u + e2[1] * v + dir[1] * t, o[2] + e1[2] * u + e2[2] * v + dir[2] * t];
    const q = clean2(pts);
    return fromCaps(q.map(p => P(p[0], p[1], t0)), q.map(p => P(p[0], p[1], t1)));
  }
  function ngon(cx, cy, rx, ry, n, rot) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (rot || 0) + 2 * Math.PI * i / n;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return pts;
  }
  /** Rounded slot outline, long along the first axis. */
  function stadium(cx, cy, hw, ht, seg) {
    const r = ht, c = Math.max(0, hw - ht), pts = [];
    for (let i = 0; i <= seg; i++) { const a = -Math.PI / 2 + Math.PI * i / seg; pts.push([cx + c + r * Math.cos(a), cy + r * Math.sin(a)]); }
    for (let i = 0; i <= seg; i++) { const a = Math.PI / 2 + Math.PI * i / seg; pts.push([cx - c + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return pts;
  }

  /* ---------- Frame model ---------- */

  function Builder() { this.solids = []; this.hidden = []; this.moves = {}; }
  Builder.prototype.add = function (piece, P, extra) {
    P.piece = piece;
    if (extra) Object.assign(P, extra);
    this.solids.push(P);
    return P;
  };
  Builder.prototype.cut = function (pieces, C) {
    const set = [].concat(pieces);
    this.solids = this.solids.flatMap(S => set.includes(S.piece) ? subtract(S, C) : [S]);
  };
  Builder.prototype.line = function (pts, closed) { this.hidden.push({ pts, closed: !!closed }); };

  const BUILD = {};

  // Each builder works in a local frame where the stiles (left/right) are the members that run through.
  // L: { OW, OH, wl, wr (stile widths), wt, wb (rail widths), T }.

  function traps(L) {
    const { OW, OH, wl, wr, wt, wb } = L;
    return {
      top: [[0, OH], [wl, OH - wt], [OW - wr, OH - wt], [OW, OH]],
      bottom: [[0, 0], [OW, 0], [OW - wr, wb], [wl, wb]],
      left: [[0, 0], [wl, wb], [wl, OH - wt], [0, OH]],
      right: [[OW, 0], [OW, OH], [OW - wr, OH - wt], [OW - wr, wb]],
    };
  }
  function cornersOf(L) {
    const { OW, OH, wl, wr, wt, wb } = L;
    return [
      { x: 0, y: OH, ix: wl, iy: OH - wt, sx: 1, sy: -1, a: 'top', b: 'left', wa: wt, wb: wl },
      { x: OW, y: OH, ix: OW - wr, iy: OH - wt, sx: -1, sy: -1, a: 'top', b: 'right', wa: wt, wb: wr },
      { x: 0, y: 0, ix: wl, iy: wb, sx: 1, sy: 1, a: 'bottom', b: 'left', wa: wb, wb: wl },
      { x: OW, y: 0, ix: OW - wr, iy: wb, sx: -1, sy: 1, a: 'bottom', b: 'right', wa: wb, wb: wr },
    ];
  }

  BUILD.miter = (B, L, p, d) => {
    const T = L.T, tp = traps(L);
    for (const k of ['top', 'bottom', 'left', 'right']) B.add(k, prism(tp[k], 0, T, 'z'));
    const corners = cornersOf(L);
    if (p.miterReinf === 'keys') {
      const n = p.keys, kt = p.keyThick, Lk = p.keyLeg;
      corners.forEach((c, ci) => {
        const tri = [[c.x, c.y], [c.x + c.sx * Lk, c.y], [c.x, c.y + c.sy * Lk]];
        for (let i = 1; i <= n; i++) {
          const zc = T - T * i / (n + 1);
          B.cut([c.a, c.b], prism(tri, zc - kt / 2, zc + kt / 2, 'z'));
          B.add(`key${ci}-${i}`, prism(tri, zc - kt / 2, zc + kt / 2, 'z'),
            { mat: 'accent', grain: norm([-c.sx, c.sy, 0]), move: [-c.sx * 1.6, -c.sy * 1.6, 0] });
        }
        B.line(tri, true);
      });
    } else if (p.miterReinf === 'vnails') {
      let size = 7;
      for (const v of [7, 10, 12, 15]) if (v <= 0.65 * T * Core.MM) size = v;
      const sz = size / Core.MM;
      const n = Math.min(L.wl, L.wt, L.wb) - d.R >= 1.25 ? 2 : 1;
      corners.forEach((c, ci) => {
        const tmax = Math.max(0.2, Math.min(1 - d.R / c.wa, 1 - d.R / c.wb));
        const u = norm([c.ix - c.x, c.iy - c.y, 0]), v = [-u[1], u[0], 0];
        for (let i = 0; i < n; i++) {
          const t = tmax * (i + 1) / (n + 1);
          const m = [c.x + (c.ix - c.x) * t, c.y + (c.iy - c.y) * t];
          const apex = [m[0] - u[0] * 0.06, m[1] - u[1] * 0.06];
          for (const sgn of [1, -1]) {
            const end = [m[0] + u[0] * 0.1 + v[0] * 0.15 * sgn, m[1] + u[1] * 0.1 + v[1] * 0.15 * sgn];
            const e = norm([end[0] - apex[0], end[1] - apex[1], 0]), q = [-e[1] * 0.014, e[0] * 0.014];
            B.add(`vn${ci}-${i}-${sgn}`, prism([[apex[0] + q[0], apex[1] + q[1]], [end[0] + q[0], end[1] + q[1]], [end[0] - q[0], end[1] - q[1]], [apex[0] - q[0], apex[1] - q[1]]], -0.006, sz, 'z'),
              { mat: 'metal', grain: [0, 0, 1], moveWith: [c.a, c.b] });
          }
        }
      });
    } else if (p.miterReinf === 'biscuits') {
      const avail = Math.hypot(L.wl, Math.min(L.wt, L.wb));
      const b = Core.BISCUITS.find(x => x.len + 0.25 <= avail);
      if (b) {
        const zc = d.R > 0 ? d.D + (T - d.D) / 2 : T / 2;
        corners.forEach((c, ci) => {
          const u = norm([c.ix - c.x, c.iy - c.y, 0]), v = [-u[1], u[0], 0];
          const m = [(c.x + c.ix) / 2, (c.y + c.iy) / 2];
          const pts = [];
          for (let i = 0; i < 12; i++) {
            const a = 2 * Math.PI * i / 12;
            pts.push([m[0] + u[0] * b.len / 2 * Math.cos(a) + v[0] * b.wid / 2 * Math.sin(a), m[1] + u[1] * b.len / 2 * Math.cos(a) + v[1] * b.wid / 2 * Math.sin(a)]);
          }
          B.cut([c.a, c.b], prism(pts, zc - 0.08, zc + 0.08, 'z'));
          B.add(`bis${ci}`, prism(pts, zc - 0.078, zc + 0.078, 'z'), { mat: 'hw', grain: u, moveWith: [c.a, c.b] });
          B.line(pts, true);
        });
      }
    }
  };

  BUILD.halflap = (B, L, p) => {
    const { OW, OH, wl, wr, wt, wb, T } = L, dd = p.lapDepth;
    B.add('left', box(0, wl, 0, OH, 0, T));
    B.add('right', box(OW - wr, OW, 0, OH, 0, T));
    B.add('top', box(0, OW, OH - wt, OH, 0, T));
    B.add('bottom', box(0, OW, 0, wb, 0, T));
    // The through pieces keep their front at the corners; the others keep their back.
    B.cut('left', box(-1, wl + 1, OH - wt, OH + 1, -1, dd));
    B.cut('left', box(-1, wl + 1, -1, wb, -1, dd));
    B.cut('right', box(OW - wr - 1, OW + 1, OH - wt, OH + 1, -1, dd));
    B.cut('right', box(OW - wr - 1, OW + 1, -1, wb, -1, dd));
    B.cut('top', box(-1, wl, OH - wt - 1, OH + 1, dd, T + 1));
    B.cut('top', box(OW - wr, OW + 1, OH - wt - 1, OH + 1, dd, T + 1));
    B.cut('bottom', box(-1, wl, -1, wb + 1, dd, T + 1));
    B.cut('bottom', box(OW - wr, OW + 1, -1, wb + 1, dd, T + 1));
    B.moves = { left: [-0.25, 0, 1.3], right: [0.25, 0, 1.3], top: [0, 0.15, 0], bottom: [0, -0.15, 0] };
    B.line([[0, OH - wt], [wl, OH - wt]]); B.line([[OW - wr, OH - wt], [OW, OH - wt]]);
    B.line([[0, wb], [wl, wb]]); B.line([[OW - wr, wb], [OW, wb]]);
  };

  BUILD.mitredlap = (B, L, p) => {
    const { OW, OH, wl, wr, wt, wb, T } = L, dd = p.lapDepth, tp = traps(L);
    B.add('top', prism(tp.top, dd, T, 'z')); B.add('top', box(wl, OW - wr, OH - wt, OH, 0, dd));
    B.add('bottom', prism(tp.bottom, dd, T, 'z')); B.add('bottom', box(wl, OW - wr, 0, wb, 0, dd));
    B.add('left', box(0, wl, 0, OH, 0, dd)); B.add('left', prism(tp.left, dd, T, 'z'));
    B.add('right', box(OW - wr, OW, 0, OH, 0, dd)); B.add('right', prism(tp.right, dd, T, 'z'));
    B.moves = { top: [0, 0.2, 1.3], bottom: [0, -0.2, 1.3], left: [-0.2, 0, 0], right: [0.2, 0, 0] };
    B.line([[wl, OH - wt], [wl, OH]]); B.line([[OW - wr, OH - wt], [OW - wr, OH]]);
    B.line([[wl, 0], [wl, wb]]); B.line([[OW - wr, 0], [OW - wr, wb]]);
  };

  BUILD.bridle = (B, L, p) => {
    const { OW, OH, wl, wr, wt, wb, T } = L, t = p.tenonThick, z0 = (T - t) / 2, z1 = z0 + t;
    B.add('left', box(0, wl, 0, OH, 0, T));
    B.add('right', box(OW - wr, OW, 0, OH, 0, T));
    B.cut('left', box(-1, wl + 1, OH - wt, OH + 1, z0, z1)); B.cut('left', box(-1, wl + 1, -1, wb, z0, z1));
    B.cut('right', box(OW - wr - 1, OW + 1, OH - wt, OH + 1, z0, z1)); B.cut('right', box(OW - wr - 1, OW + 1, -1, wb, z0, z1));
    B.add('top', box(wl, OW - wr, OH - wt, OH, 0, T));
    B.add('top', box(0, wl, OH - wt, OH, z0, z1)); B.add('top', box(OW - wr, OW, OH - wt, OH, z0, z1));
    B.add('bottom', box(wl, OW - wr, 0, wb, 0, T));
    B.add('bottom', box(0, wl, 0, wb, z0, z1)); B.add('bottom', box(OW - wr, OW, 0, wb, z0, z1));
    B.moves = { top: [0, 0, 0], bottom: [0, 0, 0] };
    B.line([[0, OH - wt], [wl, OH - wt]]); B.line([[OW - wr, OH - wt], [OW, OH - wt]]);
    B.line([[0, wb], [wl, wb]]); B.line([[OW - wr, wb], [OW, wb]]);
  };

  BUILD.mortise = (B, L, p) => {
    const { OW, OH, wl, wr, wt, wb, T } = L;
    const t = p.tenonThick, tl = p.tenonLen, so = p.shoulderOut, si = p.shoulderIn, horn = p.horn;
    const z0 = (T - t) / 2, z1 = z0 + t, deep = 0.0625;
    B.add('left', box(0, wl, -horn, OH + horn, 0, T));
    B.add('right', box(OW - wr, OW, -horn, OH + horn, 0, T));
    B.add('top', box(wl, OW - wr, OH - wt, OH, 0, T));
    B.add('bottom', box(wl, OW - wr, 0, wb, 0, T));
    const ten = [
      { piece: 'top', into: 'left', x0: wl - tl, x1: wl, m0: wl - tl - deep, m1: wl + 0.01, y0: OH - wt + si, y1: OH - so },
      { piece: 'top', into: 'right', x0: OW - wr, x1: OW - wr + tl, m0: OW - wr - 0.01, m1: OW - wr + tl + deep, y0: OH - wt + si, y1: OH - so },
      { piece: 'bottom', into: 'left', x0: wl - tl, x1: wl, m0: wl - tl - deep, m1: wl + 0.01, y0: so, y1: wb - si },
      { piece: 'bottom', into: 'right', x0: OW - wr, x1: OW - wr + tl, m0: OW - wr - 0.01, m1: OW - wr + tl + deep, y0: so, y1: wb - si },
    ];
    for (const k of ten) {
      if (k.y1 - k.y0 <= 0.02) continue;
      B.cut(k.into, box(k.m0, k.m1, k.y0, k.y1, z0, z1));
      B.add(k.piece, box(k.x0, k.x1, k.y0, k.y1, z0, z1));
      B.line([[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1]], true);
    }
    B.moves = { top: [0, 0, 0], bottom: [0, 0, 0] };
  };

  function grooved(B, L, depth, gw, profile) {
    const { OW, OH, wl, wr, wt, wb, T } = L;
    const z0 = (T - gw) / 2, z1 = z0 + gw;
    B.add('left', box(0, wl, 0, OH, 0, T));
    B.add('right', box(OW - wr, OW, 0, OH, 0, T));
    B.cut('left', box(wl - depth, wl + 1, -1, OH + 1, z0, z1));
    B.cut('right', box(OW - wr - 1, OW - wr + depth, -1, OH + 1, z0, z1));
    B.add('top', box(wl, OW - wr, OH - wt, OH, 0, T));
    B.add('top', box(wl - depth, wl, OH - wt, OH, z0, z1)); B.add('top', box(OW - wr, OW - wr + depth, OH - wt, OH, z0, z1));
    B.add('bottom', box(wl, OW - wr, 0, wb, 0, T));
    B.add('bottom', box(wl - depth, wl, 0, wb, z0, z1)); B.add('bottom', box(OW - wr, OW - wr + depth, 0, wb, z0, z1));
    let c = 0;
    if (profile) {
      c = Math.min(depth, T - z1 - 0.03, 0.375);
      if (c > 0.04) {
        // The coped rail ends fill the stiles' profile, so the sticking meets like a miter.
        B.add('top', prism([[wl - c, T], [wl, T], [wl, T - c]], OH - wt, OH, 'y'));
        B.add('top', prism([[OW - wr + c, T], [OW - wr, T], [OW - wr, T - c]], OH - wt, OH, 'y'));
        B.add('bottom', prism([[wl - c, T], [wl, T], [wl, T - c]], 0, wb, 'y'));
        B.add('bottom', prism([[OW - wr + c, T], [OW - wr, T], [OW - wr, T - c]], 0, wb, 'y'));
      } else c = 0;
    }
    B.cut('top', box(-1, OW + 1, OH - wt - 1, OH - wt + depth, z0, z1));
    B.cut('bottom', box(-1, OW + 1, wb - depth, wb + 1, z0, z1));
    if (c) {
      const e = 0.02;
      B.cut('left', prism([[wl - c - e, T + e], [wl + e, T + e], [wl + e, T - c - e]], -1, OH + 1, 'y'));
      B.cut('right', prism([[OW - wr + c + e, T + e], [OW - wr - e, T + e], [OW - wr - e, T - c - e]], -1, OH + 1, 'y'));
      B.cut('top', prism([[OH - wt + c + e, T + e], [OH - wt - e, T + e], [OH - wt - e, T - c - e]], -1, OW + 1, 'x'));
      B.cut('bottom', prism([[wb - c - e, T + e], [wb + e, T + e], [wb + e, T - c - e]], -1, OW + 1, 'x'));
    }
    B.moves = { top: [0, 0, 0], bottom: [0, 0, 0] };
    B.line([[wl - depth, OH - wt], [wl, OH - wt], [wl, OH], [wl - depth, OH]], true);
    B.line([[OW - wr, OH - wt], [OW - wr + depth, OH - wt], [OW - wr + depth, OH], [OW - wr, OH]], true);
    B.line([[wl - depth, 0], [wl, 0], [wl, wb], [wl - depth, wb]], true);
    B.line([[OW - wr, 0], [OW - wr + depth, 0], [OW - wr + depth, wb], [OW - wr, wb]], true);
  }
  BUILD.tongue = (B, L, p) => grooved(B, L, p.grooveD, p.grooveW, false);
  BUILD.cope = (B, L, p) => grooved(B, L, p.copeD, p.grooveW, true);

  BUILD.butt = (B, L, p, d) => {
    const { OW, OH, wl, wr, wt, wb, T } = L;
    B.add('left', box(0, wl, 0, OH, 0, T));
    B.add('right', box(OW - wr, OW, 0, OH, 0, T));
    B.add('top', box(wl, OW - wr, OH - wt, OH, 0, T));
    B.add('bottom', box(wl, OW - wr, 0, wb, 0, T));
    B.moves = { top: [0, 0, 0], bottom: [0, 0, 0] };
    // sg: +1 when the rail is on the +x side of the joint. dir: from the outer edge into the frame.
    const joints = [
      { jx: wl, sg: 1, rail: 'top', stile: 'left', yo: OH, dir: -1, w: wt },
      { jx: OW - wr, sg: -1, rail: 'top', stile: 'right', yo: OH, dir: -1, w: wt },
      { jx: wl, sg: 1, rail: 'bottom', stile: 'left', yo: 0, dir: 1, w: wb },
      { jx: OW - wr, sg: -1, rail: 'bottom', stile: 'right', yo: 0, dir: 1, w: wb },
    ];
    joints.forEach((j, ji) => {
      const plan = Core.fastenerPlan(d, p, j.w);
      plan.positions.slice(0, plan.count).forEach((pos, k) => {
        const y = j.yo + j.dir * pos, id = `hw${ji}-${k}`, both = [j.rail, j.stile];
        if (plan.kind === 'dowels') {
          const r = plan.dia / 2, half = plan.len / 2, sec = ngon(y, plan.z, r, r, 10, 0);
          B.cut(both, prism(sec, j.jx - half - 0.0625, j.jx + half + 0.0625, 'x'));
          B.add(id, prism(sec, j.jx - half, j.jx + half, 'x'), { mat: 'hw', grain: [1, 0, 0], moveWith: both });
          B.line([[j.jx - half, y - r], [j.jx + half, y - r], [j.jx + half, y + r], [j.jx - half, y + r]], true);
        } else if (plan.kind === 'biscuits') {
          const b = plan.biscuit, pts = ngon(j.jx, y, b.wid / 2, b.len / 2, 12, 0);
          B.cut(both, prism(pts, plan.z - 0.08, plan.z + 0.08, 'z'));
          B.add(id, prism(pts, plan.z - 0.078, plan.z + 0.078, 'z'), { mat: 'hw', grain: [0, 1, 0], moveWith: both });
          B.line(pts, true);
        } else if (plan.kind === 'pocket') {
          const a = 15 / Core.DEG;
          const dir = [-j.sg * Math.cos(a), 0, Math.sin(a)];
          const tEnd = (T / 2) / Math.sin(a);
          const start = [j.jx + j.sg * tEnd * Math.cos(a), y, 0];
          const e1 = [0, 1, 0], e2 = norm(cross(dir, e1));
          B.cut(j.rail, prismDir(ngon(0, 0, 0.19, 0.19, 10, 0), start, e1, e2, dir, -0.9, tEnd - 0.3));
          B.cut(j.rail, prismDir(ngon(0, 0, 0.07, 0.07, 8, 0), start, e1, e2, dir, tEnd - 0.35, tEnd + 0.01));
          B.add(id + 'h', prismDir(ngon(0, 0, 0.16, 0.16, 10, 0), start, e1, e2, dir, tEnd - 0.42, tEnd - 0.3), { mat: 'metal', grain: [0, 0, 1], moveWith: [j.rail] });
          B.add(id + 's', prismDir(ngon(0, 0, 0.06, 0.06, 8, 0), start, e1, e2, dir, tEnd - 0.3, tEnd - 0.42 + plan.screw), { mat: 'metal', grain: [0, 0, 1], moveWith: [j.rail] });
        } else {
          const dm = plan.domino, sec = stadium(y, plan.z, dm.w / 2, dm.t / 2, 4), half = dm.len / 2;
          B.cut(both, prism(sec, j.jx - half - 0.04, j.jx + half + 0.04, 'x'));
          B.add(id, prism(sec, j.jx - half, j.jx + half, 'x'), { mat: 'hw', grain: [1, 0, 0], moveWith: both });
          B.line([[j.jx - half, y - dm.w / 2], [j.jx + half, y - dm.w / 2], [j.jx + half, y + dm.w / 2], [j.jx - half, y + dm.w / 2]], true);
        }
      });
    });
  };

  const WOOD = {
    top: { mat: 'rail', grain: [1, 0, 0] }, bottom: { mat: 'rail', grain: [1, 0, 0] },
    left: { mat: 'stile', grain: [0, 1, 0] }, right: { mat: 'stile', grain: [0, 1, 0] },
  };
  const DEFAULT_MOVES = { top: [0, 1, 0], bottom: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0] };
  const SWAP = { left: 'bottom', right: 'top', bottom: 'left', top: 'right' };

  /**
   * Build the 3D model for a computed frame.
   * opts.corner: only the top-left corner, cut off as a section. opts.explode: 0 (assembled) to 1.
   */
  function buildModel(R, opts) {
    opts = opts || {};
    const s = R.state, d = R.dims, p = R.params;
    const thr = !!p.thr;
    const L = thr
      ? { OW: d.OH, OH: d.OW, wl: d.wB, wr: d.wT, wt: d.ws, wb: d.ws, T: d.T }
      : { OW: d.OW, OH: d.OH, wl: d.ws, wr: d.ws, wt: d.wT, wb: d.wB, T: d.T };
    const B = new Builder();
    BUILD[s.joint](B, L, p, d);
    const moves = Object.assign({}, DEFAULT_MOVES, B.moves);
    for (const S of B.solids) {
      if (S.move) continue;
      if (S.moveWith) {
        const m = [0, 0, 0];
        for (const k of S.moveWith) { const v = moves[k] || [0, 0, 0]; m[0] += v[0]; m[1] += v[1]; m[2] += v[2]; }
        S.move = m.map(v => v / S.moveWith.length);
      } else S.move = moves[S.piece] || [0, 0, 0];
    }
    let solids = B.solids, hidden = B.hidden;
    if (thr) {
      const sw = v => [v[1], v[0], v[2]];
      solids = solids.map(S => Object.assign({}, S, {
        faces: S.faces.map(f => f.map(sw)), piece: SWAP[S.piece] || S.piece,
        move: sw(S.move), grain: S.grain ? sw(S.grain) : S.grain,
      }));
      hidden = hidden.map(h => ({ pts: h.pts.map(q => [q[1], q[0]]), closed: h.closed }));
    }
    for (const S of solids) if (WOOD[S.piece]) { S.mat = WOOD[S.piece].mat; S.grain = WOOD[S.piece].grain; }
    if (d.R > 1e-6 && d.D > 1e-6) {
      const rab = box(d.ws - d.R, d.OW - d.ws + d.R, d.wB - d.R, d.OH - d.wT + d.R, -1, d.D);
      solids = solids.flatMap(S => S.mat === 'metal' ? [S] : subtract(S, rab));
    }
    if (opts.corner) {
      const stub = Math.max(d.ws, d.wT) * 1.7 + 1;
      const cx = Math.min(d.OW * 0.55, stub), cy = Math.min(d.OH * 0.55, stub);
      solids = solids.map(S => { const Q = clip(S, [1, 0, 0], cx); return Q && clip(Q, [0, -1, 0], -(d.OH - cy)); }).filter(Boolean);
    }
    const ex = (opts.explode || 0) * Math.max(d.ws, d.wT, d.wB) * 0.85;
    if (ex > 0) solids = solids.map(S => translate(S, [S.move[0] * ex, S.move[1] * ex, S.move[2] * ex]));
    return { solids, hidden };
  }

  return { box, prism, prismDir, ngon, stadium, clip, subtract, translate, volume, centroid, bbox, newell, buildModel };
});
