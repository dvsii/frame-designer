/* Framewright renderer: a small z-buffer rasterizer for convex solids, drawn into a 2D canvas
   with flat shading, procedural wood grain and outlines wherever two pieces or two faces meet. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FWRender = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MATS = {
    rail: [226, 184, 130],
    stile: [181, 124, 76],
    accent: [94, 60, 38],
    hw: [238, 216, 166],
    metal: [164, 170, 180],
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  function newell(f) {
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]);
    }
    return [x, y, z];
  }

  /** Turn solids into flat faces with normals, outline keys and grain parameters. Do this once per model. */
  function prepare(solids) {
    const pieceIds = new Map(), planeIds = new Map(), pieceCenter = new Map();
    for (const S of solids) {
      let c = pieceCenter.get(S.piece);
      if (!c) pieceCenter.set(S.piece, c = [0, 0, 0, 0]);
      for (const f of S.faces) for (const p of f) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; c[3]++; }
    }
    const faces = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const S of solids) {
      let pid = pieceIds.get(S.piece);
      if (pid == null) { pid = pieceIds.size; pieceIds.set(S.piece, pid); }
      let sc = [0, 0, 0], k = 0;
      for (const f of S.faces) for (const p of f) {
        sc[0] += p[0]; sc[1] += p[1]; sc[2] += p[2]; k++;
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
      }
      sc = sc.map(v => v / k);
      const pc = pieceCenter.get(S.piece), center = [pc[0] / pc[3], pc[1] / pc[3], pc[2] / pc[3]];
      const g = norm(S.grain || [1, 0, 0]);
      const e1 = norm(cross(g, Math.abs(g[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), e2 = cross(g, e1);
      const seed = (pid * 2.399) % 6.283;
      const rc = [dot(center, e1) + 4.5 * Math.cos(seed), dot(center, e2) + 4.5 * Math.sin(seed)];
      const base = MATS[S.mat] || MATS.rail;
      for (const f of S.faces) {
        const nn = newell(f), l = Math.hypot(nn[0], nn[1], nn[2]);
        if (l < 1e-12) continue;
        let n = [nn[0] / l, nn[1] / l, nn[2] / l], d = dot(n, f[0]);
        if (dot(n, sc) > d) { n = [-n[0], -n[1], -n[2]]; d = -d; }
        const key = `${Math.round(n[0] * 400)},${Math.round(n[1] * 400)},${Math.round(n[2] * 400)},${Math.round(d * 400)}`;
        let plid = planeIds.get(key);
        if (plid == null) { plid = planeIds.size; planeIds.set(key, plid); }
        let across = cross(n, g);
        const la = Math.hypot(across[0], across[1], across[2]);
        across = la > 1e-6 ? [across[0] / la, across[1] / la, across[2] / la] : e1;
        faces.push({
          pts: f, n, key: pid * 65536 + plid, base,
          metal: S.mat === 'metal', end: S.mat !== 'metal' && Math.abs(dot(n, g)) > 0.7,
          g, across, e1, e2, rc, seed,
        });
      }
    }
    return { faces, bounds: [minX, minY, minZ, maxX, maxY, maxZ] };
  }

  function rotation(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return [cy, 0, sy, sy * sp, cp, -cy * sp, -sy * cp, sp, cy * cp];
  }

  /** Camera that fits the whole model in a w × h box at the given angles. */
  function fit(prep, yaw, pitch, w, h, pad, maxScale) {
    const m = rotation(yaw, pitch);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const F of prep.faces) for (const p of F.pts) {
      const vx = m[0] * p[0] + m[1] * p[1] + m[2] * p[2], vy = m[3] * p[0] + m[4] * p[1] + m[5] * p[2];
      if (vx < x0) x0 = vx; if (vx > x1) x1 = vx; if (vy < y0) y0 = vy; if (vy > y1) y1 = vy;
    }
    if (!isFinite(x0)) return { yaw, pitch, scale: 1, cx: w / 2, cy: h / 2 };
    let scale = Math.min((w - 2 * pad) / Math.max(1e-6, x1 - x0), (h - 2 * pad) / Math.max(1e-6, y1 - y0));
    if (maxScale) scale = Math.min(scale, maxScale);
    return { yaw, pitch, scale, cx: w / 2 - (x0 + x1) / 2 * scale, cy: h / 2 + (y0 + y1) / 2 * scale };
  }

  function Renderer(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
  }

  /** Draw prepared faces. cam: { yaw, pitch, scale (css px per inch), cx, cy (css px) }. */
  Renderer.prototype.render = function (prep, cam, opt) {
    opt = opt || {};
    const cw = opt.width, ch = opt.height;
    const res = opt.res || Math.min(3, Math.max(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1));
    const W = Math.max(1, Math.round(cw * res)), H = Math.max(1, Math.round(ch * res));
    const c = this.c;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    c.style.width = cw + 'px'; c.style.height = ch + 'px';
    if (!this.zb || this.zb.length !== W * H) {
      this.zb = new Float32Array(W * H); this.fb = new Int32Array(W * H);
      this.kb = new Int32Array(W * H); this.mask = new Uint8Array(W * H);
      this.img = this.ctx.createImageData(W, H);
    }
    const zb = this.zb, fb = this.fb, kb = this.kb, mask = this.mask;
    zb.fill(-Infinity); fb.fill(-1); mask.fill(0);
    const m = rotation(cam.yaw, cam.pitch);
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
    const S = cam.scale * res, ox = cam.cx * res, oy = cam.cy * res;
    const faces = prep.faces;
    const shade = new Float32Array(faces.length);
    const Lt = norm([-0.38, 0.55, 0.74]);

    function tri(x0, y0, z0, x1, y1, z1, x2, y2, z2, fid) {
      let area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) return;
      if (area < 0) { let t = x1; x1 = x2; x2 = t; t = y1; y1 = y2; y2 = t; t = z1; z1 = z2; z2 = t; area = -area; }
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2))), maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2))), maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) return;
      const inv = 1 / area;
      const a0 = -(y2 - y1), a1 = -(y0 - y2), a2 = -(y1 - y0);
      for (let py = minY; py <= maxY; py++) {
        const fy = py + 0.5, fx = minX + 0.5;
        let w0 = (x2 - x1) * (fy - y1) - (y2 - y1) * (fx - x1);
        let w1 = (x0 - x2) * (fy - y2) - (y0 - y2) * (fx - x2);
        let w2 = (x1 - x0) * (fy - y0) - (y1 - y0) * (fx - x0);
        let i = py * W + minX;
        for (let px = minX; px <= maxX; px++, i++, w0 += a0, w1 += a1, w2 += a2) {
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = (w0 * z0 + w1 * z1 + w2 * z2) * inv;
          if (z > zb[i]) { zb[i] = z; fb[i] = fid; }
        }
      }
    }

    const xs = [], ys = [], zs = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const F = faces[fi], n = F.n;
      const vz = m20 * n[0] + m21 * n[1] + m22 * n[2];
      if (vz <= 1e-6) continue;
      const vx = m00 * n[0] + m01 * n[1] + m02 * n[2], vy = m10 * n[0] + m11 * n[1] + m12 * n[2];
      shade[fi] = 0.6 + 0.47 * Math.max(0, vx * Lt[0] + vy * Lt[1] + vz * Lt[2]);
      const P = F.pts, k = P.length;
      for (let i = 0; i < k; i++) {
        const p = P[i];
        xs[i] = ox + (m00 * p[0] + m01 * p[1] + m02 * p[2]) * S;
        ys[i] = oy - (m10 * p[0] + m11 * p[1] + m12 * p[2]) * S;
        zs[i] = m20 * p[0] + m21 * p[1] + m22 * p[2];
      }
      for (let i = 1; i < k - 1; i++) tri(xs[0], ys[0], zs[0], xs[i], ys[i], zs[i], xs[i + 1], ys[i + 1], zs[i + 1], fi);
    }

    const data = this.img.data;
    const inv = 1 / S;
    for (let py = 0, i = 0; py < H; py++) {
      const vy = -(py + 0.5 - oy) * inv;
      for (let px = 0; px < W; px++, i++) {
        const f = fb[i], o4 = i * 4;
        if (f < 0) { kb[i] = -1; data[o4 + 3] = 0; continue; }
        const F = faces[f];
        kb[i] = F.key;
        const vx = (px + 0.5 - ox) * inv, vz = zb[i];
        const X = m00 * vx + m10 * vy + m20 * vz, Y = m01 * vx + m11 * vy + m21 * vz, Z = m02 * vx + m12 * vy + m22 * vz;
        let mul = shade[f];
        if (!F.metal) {
          if (F.end) {
            const a = X * F.e1[0] + Y * F.e1[1] + Z * F.e1[2] - F.rc[0], b = X * F.e2[0] + Y * F.e2[1] + Z * F.e2[2] - F.rc[1];
            mul *= 0.8 * (1 + 0.075 * Math.sin(Math.sqrt(a * a + b * b) * 44 + F.seed));
          } else {
            const t = X * F.across[0] + Y * F.across[1] + Z * F.across[2], u = X * F.g[0] + Y * F.g[1] + Z * F.g[2];
            mul *= 1 + 0.06 * Math.sin(t * 38 + 2.6 * Math.sin(u * 0.5 + t * 2.2 + F.seed) + F.seed * 3)
              + 0.035 * Math.sin(t * 9 + u * 0.11 + F.seed * 5);
          }
        }
        const b = F.base;
        data[o4] = Math.min(255, b[0] * mul); data[o4 + 1] = Math.min(255, b[1] * mul); data[o4 + 2] = Math.min(255, b[2] * mul);
        data[o4 + 3] = 255;
      }
    }

    if (opt.edges !== false) {
      for (let py = 0, i = 0; py < H; py++) {
        for (let px = 0; px < W; px++, i++) {
          const k = kb[i];
          if (px + 1 < W && kb[i + 1] !== k) { mask[i] = 1; mask[i + 1] = 1; }
          if (py + 1 < H && kb[i + W] !== k) { mask[i] = 1; mask[i + W] = 1; }
        }
      }
      const ec = opt.edge || [42, 30, 22], sc = opt.silhouette || ec;
      for (let i = 0; i < W * H; i++) {
        if (!mask[i]) continue;
        const o4 = i * 4;
        if (kb[i] < 0) { data[o4] = sc[0]; data[o4 + 1] = sc[1]; data[o4 + 2] = sc[2]; data[o4 + 3] = 235; }
        else { data[o4] = data[o4] * 0.22 + ec[0] * 0.78; data[o4 + 1] = data[o4 + 1] * 0.22 + ec[1] * 0.78; data[o4 + 2] = data[o4 + 2] * 0.22 + ec[2] * 0.78; }
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  };

  return { MATS, prepare, fit, rotation, Renderer };
});
