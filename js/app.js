/* Frame Designer app: connects the frame math, the 3D model and the page. */
(function () {
  'use strict';
  const C = window.FWCore, G = window.FWGeom, RN = window.FWRender;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  // Storage keys keep the app's old name so designs saved before the rename still load.
  const KEY_CUR = 'framewright.current', KEY_SAVED = 'framewright.designs';
  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };
  const inFrame = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /** Escape, then typeset fractions as small numerators over denominators. */
  const fr = t => esc(t)
    .replace(/(\d+)\/(\d+)/g, '<span class="fr"><sup>$1</sup>&frasl;<sub>$2</sub></span>')
    .replace(/(&quot;)([+−])/g, '$1<span class="mk" title="a hair $2">$2</span>')
    .replace(/title="a hair \+"/g, 'title="a hair over"').replace(/title="a hair −"/g, 'title="a hair under"');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  /* ---------- State ---------- */

  function encodeState(s) {
    const bytes = new TextEncoder().encode(JSON.stringify(s));
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeHash() {
    const m = location.hash.match(/^#d=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    try {
      const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
    } catch (e) { return null; }
  }

  let state = C.normalizeState(decodeHash() || store.get(KEY_CUR) || C.defaultState());
  let R = null;
  let frontModel = null, frontPrep = null, cornerPrep = null, cornerKey = '';
  const ANGLES = { iso: [0.6, 0.45], back: [Math.PI - 0.6, 0.45], flat: [0, 0] };
  const view = { yaw: ANGLES.iso[0], pitch: ANGLES.iso[1], explode: 0.55, mode: 'corner', angle: 'iso', dragging: false };

  const prec = () => state.units === 'mm' ? state.precMm : state.precIn;
  const L = v => C.fmtLen(v, state.units, prec());
  const Lplain = v => C.fmtLen(v, state.units, prec(), { unit: false });
  const parse = t => C.parseLen(t, state.units);

  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) {
    const ks = p.split('.');
    let a = o;
    for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]];
    a[ks[ks.length - 1]] = v;
  }

  // Which "calculate" mode makes a dimension the calculated one, and what to calculate instead when it is set.
  const GROUP = { 'inner.w': 'opening', 'inner.h': 'opening', 'outside.w': 'outside', 'outside.h': 'outside', stile: 'widths', top: 'widths', bottom: 'widths' };
  const ALT = { outside: 'widths', opening: 'widths', widths: 'outside' };
  function innerWord() { return state.innerRef === 'sight' ? 'Opening' : state.mat.on ? 'Image' : 'Artwork'; }
  function solveName(g) {
    if (g === 'outside') return 'the outside size';
    if (g === 'opening') return state.innerRef === 'sight' ? 'the visible opening' : state.mat.on ? 'the image size' : 'the artwork size';
    return 'the stile and rail widths';
  }
  const LABELS = {
    'inner.w': () => `${innerWord()} width`, 'inner.h': () => `${innerWord()} height`,
    'outside.w': () => 'Outside width', 'outside.h': () => 'Outside height',
    stile: () => 'Stile width', top: () => 'Top rail width', bottom: () => 'Bottom rail width',
  };

  function update(fn) {
    fn(state);
    recompute();
    store.set(KEY_CUR, state);
  }
  function recompute() {
    R = C.compute(state);
    state = R.state;
    frontModel = frontPrep = cornerPrep = null;
    schedule();
  }
  let raf = 0;
  function schedule() {
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderAll(); });
  }

  function setLen(path, v) {
    let switched = null;
    update(s => {
      const g = GROUP[path];
      if (g && g === s.solve) {
        s.solve = ALT[g];
        switched = s.solve;
        if (s.solve === 'widths') s.linkWidths = false;
      }
      if (g === 'widths' && s.linkWidths) { s.stile = v; s.top = v; s.bottom = v; }
      else setPath(s, path, v);
    });
    if (switched) toast(`Now calculating ${solveName(switched)}`);
  }

  /* ---------- Toast ---------- */

  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ---------- Joint picker ---------- */

  function buildJoints() {
    $('#joints').innerHTML = C.JOINTS.map(j =>
      `<button type="button" class="jcard" data-joint="${j.id}" aria-pressed="false" title="${esc(j.blurb)}"><canvas aria-hidden="true"></canvas><span>${esc(j.name)}</span></button>`).join('');
    $('#joints').addEventListener('click', e => {
      const b = e.target.closest('.jcard');
      if (b && b.dataset.joint !== state.joint) update(s => { s.joint = b.dataset.joint; });
    });
  }
  function drawThumbs() {
    for (const b of $$('#joints .jcard')) {
      const id = b.dataset.joint;
      const jp = id === 'butt' ? { buttReinf: 'dowels' } : {};
      const RR = C.compute(Object.assign(C.defaultState(), { joint: id, jp }));
      if (!RR.ok) continue;
      const prep = RN.prepare(G.buildModel(RR, { corner: true, explode: 0.45 }).solids);
      new RN.Renderer(b.querySelector('canvas')).render(prep, RN.fit(prep, 0.6, 0.45, 122, 76, 4), { width: 122, height: 76, res: 2 });
    }
  }

  /* ---------- Inspector ---------- */

  const THROUGH_LABEL = {
    halflap: 'Shows on the front, running through', bridle: 'Gets the open slot (shows on the front)',
    mortise: 'Gets the mortises (runs full length)', tongue: 'Runs full length', cope: 'Runs full length', butt: 'Runs full length',
  };
  const JF = {
    miter: [
      { k: 'miterReinf', type: 'select', label: 'Reinforcement', opts: [['none', 'Glue only'], ['vnails', 'V-nails'], ['biscuits', 'Biscuits']] },
    ],
    miterspline: [
      { k: 'keys', type: 'select', label: 'Splines per corner', opts: [[1, '1'], [2, '2'], [3, '3']] },
      { k: 'keyLeg', type: 'len', label: 'Spline size along the edge' },
      { k: 'keyThick', type: 'len', label: 'Spline thickness' },
    ],
    halflap: [{ k: 'lapDepth', type: 'len', label: 'Lap depth, through pieces' }],
    mitredlap: [{ k: 'lapDepth', type: 'len', label: 'Back lap thickness' }],
    bridle: [{ k: 'tenonThick', type: 'len', label: 'Tenon thickness' }],
    mortise: [
      { k: 'tenonThick', type: 'len', label: 'Tenon thickness' },
      { k: 'tenonLen', type: 'len', label: 'Tenon length' },
      { k: 'shoulderOut', type: 'len', label: 'Outer shoulder' },
      { k: 'shoulderIn', type: 'len', label: 'Inner shoulder' },
      { k: 'horn', type: 'len', label: 'Horns, each end' },
    ],
    tongue: [{ k: 'grooveW', type: 'len', label: 'Groove width' }, { k: 'grooveD', type: 'len', label: 'Groove depth' }],
    cope: [{ k: 'copeD', type: 'len', label: 'Cope depth of your bits' }, { k: 'grooveW', type: 'len', label: 'Groove width' }],
    butt: [
      { k: 'buttReinf', type: 'select', label: 'Reinforcement', opts: [['dowels', 'Dowels'], ['biscuits', 'Biscuits'], ['pocket', 'Pocket screws'], ['domino', 'Loose tenons (Domino)']] },
      { k: 'dowelDia', type: 'len', label: 'Dowel diameter', when: p => p.buttReinf === 'dowels' },
      { k: 'dowelLen', type: 'len', label: 'Dowel length', when: p => p.buttReinf === 'dowels' },
    ],
  };

  function renderJointFields() {
    const p = R.params;
    const defs = (JF[state.joint] || []).filter(f => !f.when || f.when(p));
    const box = $('#joint-fields');
    const sig = state.joint + '|' + defs.map(f => f.k).join(',');
    if (box.dataset.sig !== sig) {
      box.innerHTML = defs.map(f => f.type === 'select'
        ? `<label class="field span2"><span class="lbl">${esc(f.label)}</span><span class="inp"><select id="jp-${f.k}" data-jp="${f.k}" data-type="select">${f.opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></span></label>`
        : `<label class="field"><span class="lbl">${esc(f.label)}<span class="auto" data-auto="${f.k}"></span></span><span class="inp"><input id="jp-${f.k}" data-jp="${f.k}" spellcheck="false"><span class="u"></span></span></label>`).join('')
        || '<p class="help span2">This joint has no extra settings.</p>';
      box.dataset.sig = sig;
    }
    for (const f of defs) {
      const el = $(`#jp-${f.k}`);
      if (!el) continue;
      if (f.type === 'select') { el.value = String(p[f.k]); continue; }
      if (document.activeElement !== el && !el.closest('.field').classList.contains('bad')) el.value = Lplain(p[f.k]);
      el.setAttribute('inputmode', state.units === 'mm' ? 'decimal' : 'text');
      const tag = box.querySelector(`[data-auto="${f.k}"]`);
      const set = state.jp[f.k] != null;
      tag.innerHTML = set ? `<button type="button" class="reset" data-reset="${f.k}">Back to auto</button>` : 'auto';
    }
  }

  function renderForm() {
    const s = state;
    const unit = s.units === 'mm' ? 'mm' : 'in';
    for (const el of $$('#inspector [data-path]')) {
      const path = el.dataset.path, kind = el.dataset.kind || 'len';
      const v = getPath(s, path);
      if (kind === 'bool') { el.checked = !!v; continue; }
      if (document.activeElement === el) continue;
      const f = el.closest('.field');
      if (f && f.classList.contains('bad')) continue;
      el.value = kind === 'int' ? String(v) : Lplain(v);
      if (kind === 'len') el.setAttribute('inputmode', s.units === 'mm' ? 'decimal' : 'text');
    }
    $$('.u').forEach(u => { u.textContent = unit; });
    for (const f of $$('#inspector [data-calc]')) f.classList.toggle('calc', f.dataset.calc === s.solve);
    $$('.lbl-inner').forEach(e => { e.textContent = innerWord(); });
    $('#solve-inner-btn').textContent = s.innerRef === 'sight' ? 'Opening' : s.mat.on ? 'Image size' : 'Artwork size';
    $('#f-link').disabled = s.solve === 'widths';
    $('#mat-fields').style.display = s.mat.on ? 'grid' : 'none';
    const sel = $('#f-prec');
    if (sel.dataset.sig !== s.units) {
      const opts = s.units === 'mm' ? [[1, '1 mm'], [0.5, '0.5 mm'], [0.1, '0.1 mm']] : [[8, 'Nearest 1/8"'], [16, 'Nearest 1/16"'], [32, 'Nearest 1/32"'], ['dec', 'Decimal inches']];
      sel.innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
      sel.dataset.sig = s.units;
    }
    sel.value = String(s.units === 'mm' ? s.precMm : s.precIn);
    const j = R.joint;
    $('#through-field').hidden = !j.through;
    $('#lbl-through').textContent = THROUGH_LABEL[s.joint] || 'Runs through';
    $('#lg-joint').textContent = `${j.name}`;
  }

  function markBad(t, msg) {
    const f = t.closest('.field');
    f.classList.add('bad');
    let e = f.querySelector('.err');
    if (!e) { e = document.createElement('span'); e.className = 'err'; f.appendChild(e); }
    e.textContent = msg;
  }
  function clearBad(t) {
    const f = t.closest('.field');
    if (!f) return;
    f.classList.remove('bad');
    const e = f.querySelector('.err');
    if (e) e.remove();
  }

  function commitPath(t) {
    const path = t.dataset.path, kind = t.dataset.kind || 'len';
    if (kind === 'bool') return update(s => setPath(s, path, t.checked));
    if (kind === 'int') {
      const v = parseInt(t.value, 10);
      if (!(v >= 1 && v <= 99)) return markBad(t, 'Enter a whole number from 1 to 99.');
      clearBad(t);
      return update(s => setPath(s, path, v));
    }
    const v = parse(t.value);
    if (!isFinite(v) || v < 0) return markBad(t, `Can't read "${t.value}". Try 11 3/4, 11.75 or 298 mm.`);
    clearBad(t);
    if (GROUP[path]) setLen(path, v);
    else update(s => setPath(s, path, v));
  }
  function commitJp(t) {
    const k = t.dataset.jp;
    if (t.dataset.type === 'select') {
      const v = k === 'keys' ? +t.value : t.value;
      return update(s => { s.jp[k] = v; });
    }
    if (!t.value.trim()) { clearBad(t); return update(s => { delete s.jp[k]; }); }
    const v = parse(t.value);
    if (!isFinite(v) || v < 0) return markBad(t, `Can't read "${t.value}".`);
    clearBad(t);
    update(s => { s.jp[k] = v; });
  }

  function bindInspector() {
    const form = $('#inspector');
    form.addEventListener('submit', e => e.preventDefault());
    form.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'f-prec') return update(s => { if (s.units === 'mm') s.precMm = +t.value; else s.precIn = t.value === 'dec' ? 'dec' : +t.value; });
      if (t.dataset.path) return commitPath(t);
      if (t.dataset.jp) return commitJp(t);
    });
    form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') { e.preventDefault(); e.target.blur(); }
    });
    form.addEventListener('focusin', e => { if (e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') e.target.select(); });
    form.addEventListener('click', e => {
      const r = e.target.closest('[data-reset]');
      if (r) { e.preventDefault(); const k = r.dataset.reset; update(s => { delete s.jp[k]; }); }
    });
  }

  /* ---------- Segmented controls ---------- */

  function setSeg(name, val) {
    for (const b of $$(`[data-seg="${name}"] button`)) b.setAttribute('aria-pressed', String(b.dataset.val === String(val)));
  }
  function bindSegs() {
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-seg] button');
      if (!b) return;
      const seg = b.closest('[data-seg]').dataset.seg, val = b.dataset.val;
      if (seg === 'units') update(s => { s.units = val; });
      else if (seg === 'solve') update(s => { s.solve = val; if (val === 'widths') s.linkWidths = false; });
      else if (seg === 'innerRef') {
        if (val === state.innerRef) return;
        const d = R.dims;
        update(s => {
          // Keep the same frame: re-express the inside size in the new terms.
          if (R.ok) s.inner = val === 'sight' ? { w: d.SW, h: d.SH } : s.mat.on ? { w: d.IW, h: d.IH } : { w: d.GW, h: d.GH };
          s.innerRef = val;
        });
      }
      else if (seg === 'through') update(s => { s.through = val; });
      else if (seg === 'vmode') { view.mode = val; cornerPrep = null; schedule(); }
      else if (seg === 'vangle') { view.angle = val; [view.yaw, view.pitch] = ANGLES[val]; schedule(); }
    });
  }

  /* ---------- Front view ---------- */

  /** Outline color for the model's silhouette: the page's ink, so it reads on either theme. */
  function silhouette() {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
    const m = v.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [42, 30, 22];
  }

  const frontR = new RN.Renderer($('#front-canvas'));
  const charW = 7.6;
  function chipW(text) { return Math.round(text.length * charW + 16); }
  function chip(path, x, y, text, label) {
    const calc = GROUP[path] === state.solve, w = chipW(text);
    return `<g class="chip${calc ? ' calc' : ''}" data-path="${path}" tabindex="0" role="button" aria-label="${esc(label)}: ${esc(text)}${calc ? ', calculated' : ''}. Change">` +
      `<title>${esc(label)}${calc ? ' (calculated)' : ''}</title>` +
      `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${w}" height="22" rx="3"/>` +
      `<text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle">${esc(text)}</text></g>`;
  }
  const tick = (x, y) => `<line class="dimtick" x1="${x - 4}" y1="${y + 4}" x2="${x + 4}" y2="${y - 4}"/>`;
  const ln = (x1, y1, x2, y2, cls) => `<line class="${cls || 'dimline'}" x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;

  function renderFront() {
    const stage = $('#front-stage'), msg = $('#front-msg'), under = $('#front-under'), over = $('#front-over');
    const W = stage.clientWidth;
    if (!R.ok) {
      stage.style.height = '320px';
      msg.hidden = false;
      msg.innerHTML = `<div><strong>These sizes don't make a frame yet.</strong><br>${R.warnings.filter(w => w.level === 'error').map(w => fr(w.text)).join('<br>')}</div>`;
      under.innerHTML = over.innerHTML = '';
      frontR.render({ faces: [] }, { yaw: 0, pitch: 0, scale: 1, cx: 0, cy: 0 }, { width: W, height: 320 });
      return;
    }
    msg.hidden = true;
    const d = R.dims, s = state;
    const tOW = L(d.OW), tOH = L(d.OH);
    const m = { l: Math.max(64, chipW(tOH) + 26), r: 22, t: 54, b: 24 };
    const maxH = Math.max(300, Math.min(window.innerHeight * 0.72, 680));
    let sc = (W - m.l - m.r) / d.OW;
    let H = d.OH * sc + m.t + m.b;
    if (H > maxH) { sc = (maxH - m.t - m.b) / d.OH; H = maxH; }
    H = Math.round(H);
    const ox = m.l + ((W - m.l - m.r) - d.OW * sc) / 2, oy = m.t + d.OH * sc;
    const X = x => ox + x * sc, Y = y => oy - y * sc;
    stage.style.height = H + 'px';
    if (!frontPrep) { frontModel = G.buildModel(R, {}); frontPrep = RN.prepare(frontModel.solids); }
    frontR.render(frontPrep, { yaw: 0, pitch: 0, scale: sc, cx: ox, cy: oy }, { width: W, height: H, silhouette: silhouette() });

    for (const svg of [under, over]) { svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); }

    // What sits in the rabbet: mat and artwork (drawn under the frame).
    const gx0 = d.ws - d.R + d.c / 2, gy0 = d.wB - d.R + d.c / 2;
    let u = '<defs><pattern id="arthatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="9" height="9" fill="var(--art-b)"/><rect width="3" height="9" fill="var(--art-a)"/></pattern></defs>';
    const rect = (x0, y0, w, h, attrs) => `<rect x="${X(x0).toFixed(1)}" y="${Y(y0 + h).toFixed(1)}" width="${(w * sc).toFixed(1)}" height="${(h * sc).toFixed(1)}" ${attrs}/>`;
    if (s.mat.on) {
      u += rect(gx0, gy0, d.GW, d.GH, 'fill="var(--mat-board)"');
      u += rect(gx0 + s.mat.side, gy0 + s.mat.bottom, d.MW, d.MH, 'fill="url(#arthatch)" stroke="rgba(0,0,0,.25)" stroke-width="1.5"');
    } else {
      u += rect(gx0, gy0, d.GW, d.GH, 'fill="url(#arthatch)"');
    }
    under.innerHTML = u;

    // Hidden joinery, rabbet and dimensions (drawn over the frame).
    let o = '';
    o += `<rect class="rabbet-line" x="${X(d.ws - d.R).toFixed(1)}" y="${Y(d.OH - d.wT + d.R).toFixed(1)}" width="${(d.RW * sc).toFixed(1)}" height="${(d.RH * sc).toFixed(1)}"/>`;
    for (const h of frontModel.hidden) {
      const pts = h.pts.map(q => `${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join(' ');
      o += h.closed ? `<polygon class="hidden-line" points="${pts}"/>` : `<polyline class="hidden-line" points="${pts}"/>`;
    }
    // Outside width, above the frame
    const yW = Y(d.OH) - 30;
    o += ln(X(0), Y(d.OH) - 6, X(0), yW - 6) + ln(X(d.OW), Y(d.OH) - 6, X(d.OW), yW - 6) + ln(X(0), yW, X(d.OW), yW) + tick(X(0), yW) + tick(X(d.OW), yW);
    o += chip('outside.w', X(d.OW / 2), yW, tOW, 'Outside width');
    // Outside height, left of the frame
    const xH = X(0) - 20;
    o += ln(X(0) - 6, Y(0), xH - 6, Y(0)) + ln(X(0) - 6, Y(d.OH), xH - 6, Y(d.OH)) + ln(xH, Y(0), xH, Y(d.OH)) + tick(xH, Y(0)) + tick(xH, Y(d.OH));
    o += chip('outside.h', Math.max(chipW(tOH) / 2 + 2, X(0) - 8 - chipW(tOH) / 2), Y(d.OH / 2), tOH, 'Outside height');
    // Widths
    const tS = L(d.ws), tT = L(d.wT), tB = L(d.wB);
    const ys = Y(d.wB + d.SH * 0.22), xs0 = X(d.OW - d.ws), xs1 = X(d.OW);
    o += ln(xs0, ys, xs1, ys) + tick(xs0, ys) + tick(xs1, ys);
    const wS = chipW(tS);
    const xsC = wS > (xs1 - xs0) + 8 ? xs1 - 2 - wS / 2 : (xs0 + xs1) / 2;
    o += chip('stile', xsC, ys - 16, tS, 'Stile width');
    const xr = X(d.OW * 0.74);
    o += ln(xr, Y(d.OH), xr, Y(d.OH - d.wT)) + tick(xr, Y(d.OH)) + tick(xr, Y(d.OH - d.wT));
    o += chip('top', xr, Y(d.OH - d.wT / 2), tT, 'Top rail width');
    o += ln(xr, Y(0), xr, Y(d.wB)) + tick(xr, Y(0)) + tick(xr, Y(d.wB));
    o += chip('bottom', xr, Y(d.wB / 2), tB, 'Bottom rail width');
    // Inside size, in the middle of the opening
    const cx = X(d.OW / 2), cy = Y(d.wB + d.SH / 2);
    const tw = L(s.inner.w), th = L(s.inner.h);
    const ww = chipW(tw), wh = chipW(th);
    const word = { Artwork: 'Artwork', Image: 'Image', Opening: 'Visible opening' }[innerWord()];
    const sub = s.innerRef === 'sight' ? `glass ${L(d.GW)} × ${L(d.GH)}` : s.mat.on ? `mat window ${L(d.MW)} × ${L(d.MH)}` : `opening ${L(d.SW)} × ${L(d.SH)}`;
    // Drop the secondary line when the opening is too narrow on screen to hold it.
    const roomy = sub.length * 7.1 + 20 <= d.SW * sc - 12;
    const boxW = Math.max(ww + wh + 40, roomy ? sub.length * 7.1 + 20 : 0, 120);
    o += `<rect class="label-bg" x="${(cx - boxW / 2).toFixed(1)}" y="${(cy - 38).toFixed(1)}" width="${boxW.toFixed(1)}" height="${roomy ? 76 : 54}" rx="4"/>`;
    o += `<text class="center-label" x="${cx.toFixed(1)}" y="${(cy - 20).toFixed(1)}" text-anchor="middle">${esc(word)}</text>`;
    o += chip('inner.w', cx - 10 - ww / 2, cy, tw, `${innerWord()} width`);
    o += `<text class="center-sub" x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle">×</text>`;
    o += chip('inner.h', cx + 10 + wh / 2, cy, th, `${innerWord()} height`);
    if (roomy) o += `<text class="center-sub" x="${cx.toFixed(1)}" y="${(cy + 28).toFixed(1)}" text-anchor="middle">${esc(sub)}</text>`;
    over.innerHTML = o;
  }

  function bindFront() {
    const over = $('#front-over');
    const open = e => {
      const g = e.target.closest('.chip');
      if (!g) return;
      e.preventDefault();
      openEditor(g.dataset.path, g);
    };
    over.addEventListener('click', open);
    over.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); });
  }

  /* ---------- Dimension editor ---------- */

  const ed = { path: null };
  function openEditor(path, anchor) {
    ed.path = path;
    const box = $('#editor'), input = $('#ed-input');
    $('#ed-label').textContent = LABELS[path]();
    input.value = Lplain(getPath(state, path));
    input.setAttribute('inputmode', state.units === 'mm' ? 'decimal' : 'text');
    const calc = GROUP[path] === state.solve;
    $('#ed-note').textContent = calc
      ? `This size is calculated now. Setting it will calculate ${solveName(ALT[GROUP[path]])} instead.`
      : GROUP[path] === 'widths' && state.linkWidths ? 'All four members change together. Untick "Same width all round" to set them separately.' : '';
    $('#ed-err').hidden = true;
    const frs = state.units === 'mm' ? [] : [['0', 0], ['1/8', 0.125], ['1/4', 0.25], ['3/8', 0.375], ['1/2', 0.5], ['5/8', 0.625], ['3/4', 0.75], ['7/8', 0.875]];
    $('#ed-fr').innerHTML = frs.map(([t, v]) => `<button type="button" data-frac="${v}" aria-label="Set the fraction to ${t}">${t === '0' ? 'whole' : t}</button>`).join('');
    $('#ed-fr').hidden = !frs.length;
    const nudges = state.units === 'mm' ? [[-1, '−1'], [-0.5, '−0.5'], [0.5, '+0.5'], [1, '+1']].map(([v, t]) => [v / C.MM, `${t} mm`])
      : [[-0.125, '−1/8'], [-0.0625, '−1/16'], [0.0625, '+1/16'], [0.125, '+1/8']];
    $('#ed-nudge').innerHTML = nudges.map(([v, t]) => `<button type="button" data-nudge="${v}">${t}</button>`).join('');
    box.hidden = false;
    const r = anchor.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight;
    let left = clamp(r.left + r.width / 2 - bw / 2, 12, window.innerWidth - bw - 12);
    let top = r.bottom + 8;
    if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 8);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    input.focus();
    input.select();
  }
  function closeEditor(refocus) {
    const path = ed.path;
    $('#editor').hidden = true;
    ed.path = null;
    if (refocus && path) { const g = $(`#front-over .chip[data-path="${path}"]`); if (g) g.focus(); }
  }
  function commitEditor() {
    const input = $('#ed-input');
    const v = parse(input.value);
    if (!isFinite(v) || v <= 0) {
      const err = $('#ed-err');
      err.textContent = `Can't read "${input.value}". Try 11 3/4, 11.75 or 298 mm.`;
      err.hidden = false;
      return;
    }
    const path = ed.path;
    closeEditor(false);
    setLen(path, v);
    requestAnimationFrame(() => requestAnimationFrame(() => { const g = $(`#front-over .chip[data-path="${path}"]`); if (g) g.focus(); }));
  }
  function bindEditor() {
    const box = $('#editor'), input = $('#ed-input');
    $('#ed-ok').addEventListener('click', commitEditor);
    $('#ed-cancel').addEventListener('click', () => closeEditor(true));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); commitEditor(); }
      if (e.key === 'Escape') { e.preventDefault(); closeEditor(true); }
    });
    box.addEventListener('keydown', e => { if (e.key === 'Escape') closeEditor(true); });
    box.addEventListener('click', e => {
      const f = e.target.closest('[data-frac]'), n = e.target.closest('[data-nudge]');
      if (!f && !n) return;
      let v = parse(input.value);
      if (!isFinite(v)) v = getPath(state, ed.path);
      if (f) v = Math.floor(v + 1e-9) + +f.dataset.frac;
      if (n) v = Math.max(0, v + +n.dataset.nudge);
      input.value = Lplain(v);
      input.focus();
    });
    document.addEventListener('pointerdown', e => {
      if (!box.hidden && !box.contains(e.target) && !e.target.closest('.chip')) closeEditor(false);
    });
  }

  /* ---------- Corner model ---------- */

  const cornerR = new RN.Renderer($('#corner-canvas'));
  function cornerSize() { const st = $('#corner-stage'); return [st.clientWidth, st.clientHeight]; }
  function renderCorner(fast) {
    const msg = $('#corner-msg');
    const [W, H] = cornerSize();
    if (!R.ok) {
      msg.hidden = false;
      msg.textContent = 'Fix the size problems above to see the joint.';
      cornerR.render({ faces: [] }, { yaw: 0, pitch: 0, scale: 1, cx: 0, cy: 0 }, { width: W, height: H });
      return;
    }
    msg.hidden = true;
    const key = `${view.mode}|${view.explode}`;
    if (!cornerPrep || cornerKey !== key) {
      cornerPrep = RN.prepare(G.buildModel(R, { corner: view.mode === 'corner', explode: view.explode }).solids);
      cornerKey = key;
    }
    const cam = RN.fit(cornerPrep, view.yaw, view.pitch, W, H, 16, view.dragging ? view.dragScale : null);
    cornerR.render(cornerPrep, cam, { width: W, height: H, res: fast ? 1 : undefined, silhouette: silhouette() });
  }
  let fastRaf = 0;
  function requestFast() {
    if (!fastRaf) fastRaf = requestAnimationFrame(() => { fastRaf = 0; renderCorner(true); });
  }
  function bindCorner() {
    const st = $('#corner-stage');
    st.addEventListener('pointerdown', e => {
      if (!cornerPrep) return;
      const [W, H] = cornerSize();
      view.dragging = true;
      view.lx = e.clientX; view.ly = e.clientY;
      view.dragScale = RN.fit(cornerPrep, view.yaw, view.pitch, W, H, 16).scale;
      st.setPointerCapture(e.pointerId);
    });
    st.addEventListener('pointermove', e => {
      if (!view.dragging) return;
      view.yaw += (e.clientX - view.lx) * 0.01;
      view.pitch = clamp(view.pitch + (e.clientY - view.ly) * 0.01, -1.5, 1.5);
      view.lx = e.clientX; view.ly = e.clientY;
      if (view.angle) { view.angle = null; setSeg('vangle', null); }
      requestFast();
    });
    const end = () => { if (!view.dragging) return; view.dragging = false; renderCorner(false); };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    const ex = $('#explode');
    ex.value = view.explode;
    ex.addEventListener('input', () => { view.explode = +ex.value; requestFast(); });
    ex.addEventListener('change', () => { view.explode = +ex.value; renderCorner(false); });
  }

  /* ---------- Results ---------- */

  function renderResults() {
    const s = state, d = R.dims;
    $('#warnings').innerHTML = R.warnings.map(w =>
      `<div class="warn ${w.level}"><b>${w.level === 'error' ? 'Fix' : 'Check'}</b><span>${fr(w.text)}</span></div>`).join('');
    const items = [['Outside', `${L(d.OW)} × ${L(d.OH)}`], ['Visible opening', `${L(d.SW)} × ${L(d.SH)}`],
      ['Rabbet opening', `${L(d.RW)} × ${L(d.RH)}`], ['Glass and backer', `${L(d.GW)} × ${L(d.GH)}`]];
    if (s.mat.on) items.push(['Image', `${L(d.IW)} × ${L(d.IH)}`], ['Mat window', `${L(d.MW)} × ${L(d.MH)}`]);
    $('#sum').innerHTML = items.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${fr(v)}</dd></div>`).join('');
    $('#bar-sum').innerHTML = `${esc(R.joint.name)} · ${fr(`${L(d.OW)} × ${L(d.OH)}`)}`;
    $('#cut-sub').textContent = `${R.joint.name} frame${s.qty > 1 ? ` · ${s.qty} frames` : ''}`;
    if (!R.ok) {
      $('#cuts').innerHTML = ''; $('#cut-note').textContent = ''; $('#cards').innerHTML = ''; $('#mats').innerHTML = '';
      $('#layout').innerHTML = ''; $('#stock-sum').textContent = ''; $('#stock-sub').textContent = ''; $('#steps-list').innerHTML = '';
      return;
    }
    const hasShort = R.rows.some(r => r.short != null), hasRab = R.rows.some(r => r.atRabbet != null), hasSh = R.rows.some(r => r.shoulder != null);
    const hasNotes = R.rows.some(r => r.notes);
    let t = '<thead><tr><th>Part</th><th class="n">Qty</th><th>Length</th>';
    if (hasShort) t += '<th>Short point</th>';
    if (hasRab) t += '<th>On rabbet</th>';
    if (hasSh) t += '<th>Shoulders</th>';
    t += '<th>Width × thick</th><th>Ends</th>';
    if (hasNotes) t += '<th>Joinery</th>';
    t += '</tr></thead><tbody>';
    const cell = (cls, label, html) => html ? `<td class="${cls}" data-label="${label}">${html}</td>` : `<td class="${cls} empty"></td>`;
    for (const r of R.rows) {
      t += `<tr><td class="part">${esc(r.name)}</td><td class="n" data-label="Qty">${r.qtyTotal}</td><td class="len">${fr(L(r.length))}</td>`;
      if (hasShort) t += cell('mono', 'Short point', r.short != null ? fr(L(r.short)) : '');
      if (hasRab) t += cell('mono', 'On rabbet', r.atRabbet != null ? fr(L(r.atRabbet)) : '');
      if (hasSh) t += cell('mono', 'Shoulders', r.shoulder != null ? fr(L(r.shoulder)) : '');
      t += cell('mono', 'Section', fr(`${L(r.width)} × ${L(r.thick)}`)) + cell('ends', 'Ends', fr(r.ends || ''));
      if (hasNotes) t += cell('notes', 'Joinery', fr(r.notes || ''));
      t += '</tr>';
    }
    $('#cuts').innerHTML = t + '</tbody>';
    $('#cut-note').innerHTML = fr(R.lengthNote || '');
    $('#cards').innerHTML = R.cards.map(c => `<div class="card"><h4>${esc(c.title)}</h4><ul>${c.lines.map(l => `<li>${fr(l)}</li>`).join('')}</ul></div>`).join('');
    $('#mats').innerHTML = '<thead><tr><th>Item</th><th class="n">Qty</th><th>Size and notes</th></tr></thead><tbody>' +
      R.materials.map(m => `<tr><td>${esc(m.name)}</td><td class="n">${m.qty}</td><td>${m.size ? `<span class="size">${fr(m.size)}</span><br>` : ''}<span class="meta">${fr(m.note || '')}</span></td></tr>`).join('') + '</tbody>';
    renderLayout();
    $('#steps-list').innerHTML = R.steps.map(x => `<li>${fr(x)}</li>`).join('');
  }

  function renderLayout() {
    const lay = R.layout, box = $('#layout');
    const W = Math.max(280, box.clientWidth || 600);
    const labelW = 62, barW = W - labelW - 2, k = barW / lay.boardLength;
    const rowH = 30, gap = 12;
    const s = state;
    $('#stock-sub').textContent = `${plural(lay.totalBoards, 'board')} of ${L(lay.boardLength)}`;
    let sum = `${plural(lay.totalBoards, 'board')}, ${Math.round(lay.waste * 100)}% left over as offcuts and kerf.`;
    if (s.joint === 'miter' || s.joint === 'miterspline') sum += ` Buying molding? The usual rule of thumb is the perimeter plus 8 × the width: ${s.units === 'mm' ? L(lay.moldingRule) : `${(lay.moldingRule / 12).toFixed(1)} ft`}.`;
    $('#stock-sum').innerHTML = fr(sum);
    box.innerHTML = lay.groups.map((g, gi) => {
      const h = g.boards.length * (rowH + gap) + 2;
      let svg = `<svg class="board-svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" role="img" aria-label="${esc(`${g.boards.length} board layout for ${L(g.width)} stock`)}">`;
      svg += `<defs><pattern id="hatch${gi}" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="var(--panel)"/><rect width="2" height="7" fill="var(--line)"/></pattern></defs>`;
      g.boards.forEach((b, bi) => {
        const y = bi * (rowH + gap) + 1;
        svg += `<text class="bl" x="0" y="${y + rowH / 2 + 4}">Board ${bi + 1}</text>`;
        svg += `<rect class="stock" x="${labelW}" y="${y}" width="${barW}" height="${rowH}" rx="2"/>`;
        if (lay.trim > 0) svg += `<rect x="${labelW}" y="${y}" width="${(lay.trim * k).toFixed(1)}" height="${rowH}" fill="url(#hatch${gi})"/>`;
        for (const c of b.cuts) {
          const x0 = labelW + c.start * k, x1 = labelW + (c.start + c.length) * k;
          const i0 = Math.tan(c.angles[0] / C.DEG) * c.width * k, i1 = Math.tan(c.angles[1] / C.DEG) * c.width * k;
          const cls = b.over ? 'piece over' : c.label === 'Side' ? 'piece alt' : 'piece';
          svg += `<polygon class="${cls}" points="${x0.toFixed(1)},${y} ${x1.toFixed(1)},${y} ${(x1 - i1).toFixed(1)},${y + rowH} ${(x0 + i0).toFixed(1)},${y + rowH}"><title>${esc(`${c.label}, ${L(c.length)}`)}</title></polygon>`;
          const label = `${c.label} ${Lplain(c.length)}`, short = Lplain(c.length);
          const room = (x1 - x0) - Math.max(i0, i1);
          const text = room > label.length * 6.9 + 8 ? label : room > short.length * 6.9 + 6 ? short : '';
          if (text) svg += `<text class="pl${c.label === 'Side' ? ' on-dark' : ''}" x="${((x0 + x1) / 2).toFixed(1)}" y="${y + rowH / 2 + 4}" text-anchor="middle">${esc(text)}</text>`;
        }
        if (b.over) svg += `<text class="ol" x="${labelW + barW - 4}" y="${y + rowH / 2 + 4}" text-anchor="end">longer than the board</text>`;
        else if (b.remainder > 0.01) {
          const xo = labelW + (lay.trim + b.used) * k, wo = b.remainder * k;
          svg += `<rect class="off" x="${xo.toFixed(1)}" y="${y}" width="${wo.toFixed(1)}" height="${rowH}" fill="url(#hatch${gi})"/>`;
          const ot = `offcut ${Lplain(b.remainder)}`;
          if (wo > ot.length * 6.9 + 8) svg += `<text class="ol" x="${(xo + wo / 2).toFixed(1)}" y="${y + rowH / 2 + 4}" text-anchor="middle">${esc(ot)}</text>`;
        }
      });
      svg += '</svg>';
      const bf = s.units === 'mm' ? `${(g.boards.length * g.thick * g.width * lay.boardLength * Math.pow(C.MM / 1000, 3) * 1000).toFixed(2)} L` : `${g.boardFeet.toFixed(2)} board feet`;
      return `<div class="lgroup"><h3>${fr(`${L(g.width)} × ${L(g.thick)} stock`)}</h3><p class="meta">${fr(`${plural(g.boards.length, 'board')} · ${L(g.linear)} of parts · ${bf}`)}</p>${svg}</div>`;
    }).join('');
  }

  /* ---------- Copy, save, share ---------- */

  function cutListText() {
    const s = state, d = R.dims;
    const out = [`Frame Designer: ${R.joint.name} frame${s.qty > 1 ? ` (${s.qty} frames)` : ''}`,
      `Outside ${L(d.OW)} x ${L(d.OH)}   Opening ${L(d.SW)} x ${L(d.SH)}   Glass ${L(d.GW)} x ${L(d.GH)}`,
      `Stock ${L(d.T)} thick, rabbet ${L(d.R)} x ${L(d.D)}`, ''];
    const rows = [['Part', 'Qty', 'Length', 'Width', 'Ends', 'Joinery']]
      .concat(R.rows.map(r => [r.name, String(r.qtyTotal), L(r.length), L(r.width), r.ends || '', r.notes || '']));
    const w = rows[0].map((_, i) => Math.max(...rows.map(r => r[i].length)));
    for (const r of rows) out.push(r.map((c, i) => c.padEnd(w[i])).join('  ').trimEnd());
    if (R.lengthNote) out.push(R.lengthNote);
    for (const c of R.cards) { out.push('', c.title); for (const l of c.lines) out.push(`- ${l}`); }
    out.push('', 'Materials');
    for (const m of R.materials) out.push(`- ${m.qty} x ${m.name}${m.size ? `, ${m.size}` : ''}${m.note ? ` (${m.note})` : ''}`);
    out.push('', 'Steps');
    R.steps.forEach((x, i) => out.push(`${i + 1}. ${x}`));
    return out.join('\n');
  }
  function copyText(text, done) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? done : 'Copying is blocked here. Select the text on the page and copy it yourself.');
    };
    try { navigator.clipboard.writeText(text).then(() => toast(done), fallback); } catch (e) { fallback(); }
  }

  function savedList() { return store.get(KEY_SAVED) || []; }
  function renderDesigns() {
    const list = savedList();
    $('#design-list').innerHTML = list.map((x, i) =>
      `<li><span class="name">${esc(x.name)}</span><span class="meta">${fr(x.summary || '')}</span><button type="button" class="btn" data-load="${i}">Open</button><button type="button" class="btn" data-del="${i}">Delete</button></li>`).join('');
    $('#design-empty').textContent = list.length ? 'Saved designs stay in this browser on this device.' : 'Nothing saved yet. Saved designs stay in this browser on this device.';
  }
  function bindHeader() {
    const panel = $('#designs'), btn = $('#btn-designs');
    btn.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) { renderDesigns(); $('#save-name').focus(); }
    });
    $('#save-form').addEventListener('submit', e => {
      e.preventDefault();
      const d = R.dims;
      const summary = `${R.joint.name} · ${L(d.OW)} × ${L(d.OH)}`;
      const name = $('#save-name').value.trim() || summary;
      const list = savedList();
      list.unshift({ name, summary, state, saved: Date.now() });
      store.set(KEY_SAVED, list.slice(0, 50));
      $('#save-name').value = '';
      renderDesigns();
      toast(`Saved "${name}"`);
    });
    $('#design-list').addEventListener('click', e => {
      const lo = e.target.closest('[data-load]'), de = e.target.closest('[data-del]');
      const list = savedList();
      if (lo) {
        const x = list[+lo.dataset.load];
        if (!x) return;
        state = C.normalizeState(x.state);
        recompute();
        store.set(KEY_CUR, state);
        toast(`Opened "${x.name}"`);
      } else if (de) {
        if (de.dataset.confirm !== '1') { de.dataset.confirm = '1'; de.textContent = 'Confirm delete'; return; }
        list.splice(+de.dataset.del, 1);
        store.set(KEY_SAVED, list);
        renderDesigns();
      }
    });
    $('#btn-copy').addEventListener('click', () => { if (R.ok) copyText(cutListText(), 'Cut list copied'); });
    if (!inFrame) {
      const link = $('#btn-link');
      link.hidden = false;
      link.addEventListener('click', () => copyText(`${location.href.split('#')[0]}#d=${encodeState(state)}`, 'Link to this design copied'));
      const pr = $('#btn-print');
      pr.hidden = false;
      pr.addEventListener('click', () => window.print());
      let deferred = null;
      window.addEventListener('beforeinstallprompt', e => {
        e.preventDefault();
        deferred = e;
        $('#btn-install').hidden = false;
      });
      $('#btn-install').addEventListener('click', () => {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.finally(() => { deferred = null; $('#btn-install').hidden = true; });
      });
      // Only the multi-file deploy ships sw.js; the single-file builds drop the manifest link.
      if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && document.querySelector('link[rel="manifest"]')) {
        navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
      }
    }
  }

  /* ---------- Render loop ---------- */

  function renderAll() {
    setSeg('units', state.units); setSeg('solve', state.solve); setSeg('innerRef', state.innerRef); setSeg('through', state.through);
    setSeg('vmode', view.mode); setSeg('vangle', view.angle);
    for (const b of $$('#joints .jcard')) b.setAttribute('aria-pressed', String(b.dataset.joint === state.joint));
    $('#joint-blurb').textContent = R.joint.blurb;
    renderJointFields();
    renderForm();
    renderFront();
    renderCorner(false);
    renderResults();
  }

  function init() {
    buildJoints();
    bindInspector();
    bindSegs();
    bindFront();
    bindEditor();
    bindCorner();
    bindHeader();
    recompute();
    let lastW = 0;
    const ro = new ResizeObserver(() => {
      const w = $('#design').clientWidth;
      if (Math.abs(w - lastW) > 1) { lastW = w; schedule(); }
    });
    ro.observe($('#design'));
    try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', schedule); } catch (e) { /* older browsers */ }
    setTimeout(drawThumbs, 30);
  }
  init();
})();
