/*
 * XO Pulse Runner — draws a character running along the live chart line
 * on xo.market/pulse. Reads the chart canvas pixels; changes nothing else
 * on the page.
 */
(() => {
  'use strict';

  if (window.__xoPulseRunnerLoaded) return;
  window.__xoPulseRunnerLoaded = true;

  const TAG = '[xo-pulse-runner]';

  const DEFAULTS = {
    enabled: true,
    mode: 'cycle', // 'cycle' | 'tip'
    scale: 1.2,
    speed: 1,
    lineColor: 'auto', // 'auto' | '#rrggbb'
    debug: false,
  };

  let cfg = { ...DEFAULTS };

  const S = {
    src: null, // the chart's canvas
    scratch: null, // our own buffer we copy strips into for reading
    sctx: null,
    overlay: null,
    octx: null,
    ro: null,
    raf: 0,
    k: 1, // backing pixels per css pixel in the chart canvas
    css: { w: 0, h: 0 },
    dpr: 1,
    line: null, // {r,g,b} — line color
    lineFoundAt: 0,
    lastScan: 0,
    lastRangeScan: 0,
    range: null, // {x0, x1} — line bounds along X, css px
    tip: null, // {x, y} css
    slope: 0,
    runner: {
      alive: false,
      pct: 50, // position along the line, %
      x: 0,
      y: 0,
      dir: 1, // 1 — facing right, -1 — facing left
      state: 'run', // 'run' | 'walk' | 'rest'
      target: 90, // where it's heading, %
      rest: 0, // how much longer to rest, sec
      baseSpeed: 70, // px/sec before the speed multiplier
      speed: 70,
      goal: 0, // the X this leg is heading to
      restTo: 0, // the X the treadmill should carry it back to while resting
      cycleGain: 0, // ground gained forward since the last rest
      resume: 'walk', // state to return to after a jump
      jumpOff: 0, // height above the line during a jump
      jumpV: 0,
      jumpG: 1400,
      jumpVx: 0, // horizontal speed during a jump
      groundY: null, // smoothed ground height under the feet
      vFall: 0, // fall speed when the ground drops away underfoot
      hopAt: 0, // don't hop a wall more often than once per hopCooldown
      tripT: 0, // how much longer to lie there
      tripTotal: 0,
      tripPhase: 'trip', // 'trip' | 'hurt' | 'rise'
      gag: 'pant', // what it's doing while resting
      gagT: 0,
      cosmetic: null, // 'shades' | 'flower' | null, rolled fresh each round
      sprint: false, // final dash before the round ends
      vx: 0,
      vy: 0,
      phase: 0,
      angle: 0,
    },
    drift: { px: 20, prof: null, at: 0 }, // chart scroll speed, px/sec
    hurdles: [], // {x, y, knock, done}
    nextHurdle: 0, // when the next one appears
    hurdlesAt: 0, // last time their height was recalculated
    round: { prev: null, clockEl: null, lookedAt: 0 },
    dust: [],
    splash: [],
    puddles: [],
    nextPuddle: 0,
    tumbleweeds: [],
    nextTumble: 0,
    clouds: [],
    gust: [],
    lastT: 0,
    status: 'init',
    reason: '',
  };

  const PAD = 64; // margin around the chart so the character isn't clipped at the edge

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------------ *
   *  Finding the chart canvas
   * ------------------------------------------------------------------ */

  function findChartCanvas() {
    let best = null;
    let bestArea = 0;
    for (const c of document.querySelectorAll('canvas')) {
      if (c === S.overlay) continue;
      const r = c.getBoundingClientRect();
      if (r.width < 260 || r.height < 90) continue;
      const area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = c;
      }
    }
    return best;
  }

  function attach(canvas) {
    detach();
    S.src = canvas;

    const host = canvas.parentElement;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

    const ov = document.createElement('canvas');
    ov.dataset.xoPulseRunner = '1';
    Object.assign(ov.style, {
      position: 'absolute',
      left: -PAD + 'px',
      top: -PAD + 'px',
      pointerEvents: 'none',
      zIndex: '2',
    });
    host.appendChild(ov);
    S.overlay = ov;
    S.octx = ov.getContext('2d');

    S.ro = new ResizeObserver(syncSize);
    S.ro.observe(canvas);
    syncSize();

    S.line = null;
    S.tip = null;
    S.runner.alive = false;
    S.status = 'attached';
    S.reason = '';
    if (cfg.debug) console.log(TAG, 'attached to', canvas);
  }

  function detach() {
    if (S.ro) S.ro.disconnect();
    S.ro = null;
    if (S.overlay && S.overlay.parentElement) S.overlay.remove();
    S.overlay = null;
    S.octx = null;
    S.src = null;
    S.tip = null;
    S.dust.length = 0;
    S.clouds.length = 0;
  }

  function syncSize() {
    if (!S.src || !S.overlay) return;
    const r = S.src.getBoundingClientRect();
    S.css.w = r.width;
    S.css.h = r.height;
    S.dpr = window.devicePixelRatio || 1;
    S.k = r.width > 0 ? S.src.width / r.width : 1;

    // overlay is bigger than the chart by PAD on each side, so the character isn't clipped
    const ow = r.width + PAD * 2;
    const oh = r.height + PAD * 2;
    const bw = Math.max(1, Math.round(ow * S.dpr));
    const bh = Math.max(1, Math.round(oh * S.dpr));
    if (S.overlay.width !== bw || S.overlay.height !== bh) {
      S.overlay.width = bw;
      S.overlay.height = bh;
    }
    S.overlay.style.width = ow + 'px';
    S.overlay.style.height = oh + 'px';
    S.line = null;
    if (!S.clouds.length) initClouds();
  }

  function initClouds() {
    S.clouds = [];
    for (let i = 0; i < 3; i++) {
      S.clouds.push({
        x: Math.random() * S.css.w,
        y: S.css.h * (0.04 + Math.random() * 0.14),
        r: 14 + Math.random() * 10,
        speed: 6 + Math.random() * 6,
      });
    }
  }

  const CLOUD_FADE = 46; // css px near each edge over which clouds fade instead of popping

  function drawClouds(ctx, dt) {
    for (const c of S.clouds) {
      c.x -= c.speed * dt;
      if (c.x < -c.r * 3) c.x = S.css.w + c.r * 3;
      // fade in from the right, fade out on the left — softens the wrap
      // and the hard edge of the visible chart area
      const edge = Math.min(c.x / CLOUD_FADE, (S.css.w - c.x) / CLOUD_FADE);
      const fade = clamp(edge, 0, 1);
      if (fade <= 0) continue;
      // White is invisible against the chart's usually-white background —
      // needs a color with contrast. NO stroke: an outline traces each
      // circle on its own, so where they overlap you'd see seams between
      // the "blobs" instead of one soft cloud. Only the fill of several
      // overlapping ellipses gives the soft shape.
      ctx.fillStyle = `rgba(196, 214, 240, ${(0.55 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r, c.r * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.r * 0.62, c.y + c.r * 0.14, c.r * 0.6, c.r * 0.4, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.r * 0.6, c.y + c.r * 0.16, c.r * 0.56, c.r * 0.38, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.r * 0.05, c.y - c.r * 0.28, c.r * 0.5, c.r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ------------------------------------------------------------------ *
   *  Reading pixels
   * ------------------------------------------------------------------ */

  // We copy a strip of the other canvas into our own buffer instead of
  // reading it directly: the first getContext() call on someone else's
  // canvas locks in its type, so if the chart library later asks for
  // WebGL it would get null. drawImage has no such restriction.
  function readWindow(cssX, cssW) {
    if (!S.src || !S.src.width || !S.src.height) return null;
    const sx = clamp(Math.floor(cssX * S.k), 0, S.src.width - 1);
    const sw = clamp(Math.ceil(cssW * S.k), 1, S.src.width - sx);
    const h = S.src.height;

    if (!S.scratch) {
      S.scratch = document.createElement('canvas');
      S.sctx = S.scratch.getContext('2d', { willReadFrequently: true });
    }
    if (S.scratch.width !== sw || S.scratch.height !== h) {
      S.scratch.width = sw;
      S.scratch.height = h;
    }

    let img;
    try {
      S.sctx.clearRect(0, 0, sw, h);
      S.sctx.drawImage(S.src, sx, 0, sw, h, 0, 0, sw, h);
      img = S.sctx.getImageData(0, 0, sw, h);
    } catch (e) {
      S.status = 'error';
      S.reason = "can't read the chart canvas: " + e.message;
      return null;
    }
    return { d: img.data, w: sw, h, sx };
  }

  const MATCH_TOL2 = 62 * 62;

  function isLine(d, i, col) {
    if (d[i + 3] < 150) return false;
    const dr = d[i] - col.r;
    const dg = d[i + 1] - col.g;
    const db = d[i + 2] - col.b;
    return dr * dr + dg * dg + db * db < MATCH_TOL2;
  }

  /** Line Y in a given window column (backing coords), or null. */
  function yInColumn(win, col, color) {
    const { d, w, h } = win;
    let best = -1;
    let bestLen = 0;
    let run = 0;
    let sum = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + col) * 4;
      if (isLine(d, i, color)) {
        run++;
        sum += y;
      } else if (run) {
        if (run > bestLen) {
          bestLen = run;
          best = sum / run;
        }
        run = 0;
        sum = 0;
      }
    }
    if (run > bestLen) {
      bestLen = run;
      best = sum / run;
    }
    // a thick 'wall' of pixels is the fill under the line, not the line itself
    if (bestLen === 0 || bestLen > 14 * S.k) return null;
    return best;
  }

  /* ------------------------------------------------------------------ *
   *  Auto-detecting the line color
   * ------------------------------------------------------------------ */

  function detectLineColor() {
    if (cfg.lineColor !== 'auto') {
      const m = /^#?([0-9a-f]{6})$/i.exec(cfg.lineColor.trim());
      if (m) {
        const n = parseInt(m[1], 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
      }
    }

    const win = readWindow(0, S.css.w);
    if (!win) return null;
    const { d, w, h } = win;

    const counts = new Map();
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        if (d[i + 3] < 200) continue;
        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx < 45) continue; // axes and labels
        if ((mx - mn) / mx < 0.3) continue; // gray/white
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    if (!counts.size) return null;

    const cands = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key]) => ({
        r: (((key >> 10) & 31) << 3) + 4,
        g: (((key >> 5) & 31) << 3) + 4,
        b: ((key & 31) << 3) + 4,
      }));

    // the line is thin (a few pixels per column) and stretches along X
    let best = null;
    let bestScore = 0;
    for (const c of cands) {
      let hits = 0;
      let cols = 0;
      const step = Math.max(1, Math.round(w / 120));
      for (let x = 0; x < w; x += step) {
        cols++;
        if (yInColumn(win, x, c) !== null) hits++;
      }
      const coverage = cols ? hits / cols : 0;
      if (coverage < 0.35) continue;
      const mx = Math.max(c.r, c.g, c.b);
      const sat = (mx - Math.min(c.r, c.g, c.b)) / mx;
      const score = coverage * (0.5 + sat);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   *  Finding the line's tip and slope
   * ------------------------------------------------------------------ */

  // The site draws the price label in the same color right past the end of
  // the line, so we take the longest unbroken segment instead of the
  // outermost pixels of that color.
  const MAX_GAP = 4; // css-pixel gap still counted as the same line

  function scanRange() {
    const win = readWindow(0, S.css.w);
    if (!win || !S.line) return null;
    const step = Math.max(1, Math.round(S.k));
    let best = null;
    let cur = null;
    let gap = 0;
    for (let x = 0; x < win.w; x += step) {
      if (yInColumn(win, x, S.line) !== null) {
        if (!cur) cur = { x0: x, x1: x };
        cur.x1 = x;
        gap = 0;
        if (!best || cur.x1 - cur.x0 > best.x1 - best.x0) best = cur;
      } else if (cur) {
        gap += step;
        if (gap > MAX_GAP * S.k) cur = null;
      }
    }
    if (!best) return null;
    const range = { x0: best.x0 / S.k, x1: best.x1 / S.k };
    measureDrift(win, range.x1);
    return range;
  }

  /* ------------------------------------------------------------------ *
   *  "Treadmill" speed
   * ------------------------------------------------------------------ */

  // The line's tip is pinned to a fixed X while the ground underneath
  // scrolls left. We measure that scroll speed ourselves: take a height
  // profile of the line and find how far it shifted since last time
  // (cross-correlation).
  const PROF_STEP = 4; // css pixels between samples
  const PROF_SPAN = 320; // width of the sampled stretch left of the tip

  function lineProfile(win, x1) {
    const n = Math.floor(PROF_SPAN / PROF_STEP);
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const col = Math.round((x1 - PROF_SPAN + i * PROF_STEP) * S.k) - win.sx;
      const y = col >= 0 && col < win.w ? yInColumn(win, col, S.line) : null;
      p[i] = y === null ? NaN : y / S.k;
    }
    return p;
  }

  /** Mean squared difference between profiles at a shift of j steps. */
  function errAt(now, before, j) {
    if (j < 0 || j >= before.length) return Infinity;
    let err = 0;
    let cnt = 0;
    for (let i = 0; i + j < now.length; i++) {
      const a = now[i];
      const b = before[i + j];
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const d = a - b;
      err += d * d;
      cnt++;
    }
    return cnt < 24 ? Infinity : err / cnt;
  }

  function measureDrift(win, x1) {
    const D = S.drift;
    const now = performance.now();
    const prof = lineProfile(win, x1);
    if (!D.prof) {
      D.prof = prof;
      D.at = now;
      return;
    }
    const dt = (now - D.at) / 1000;
    if (dt < 1.2) return;

    // what's at point i now was further right before — at point i + j
    let bestJ = -1;
    let bestErr = Infinity;
    const n = prof.length;
    for (let j = 0; j <= 24 && j < n - 12; j++) {
      const err = errAt(prof, D.prof, j);
      if (!Number.isFinite(err)) continue;
      if (err < bestErr) {
        bestErr = err;
        bestJ = j;
      }
    }
    if (bestJ >= 0) {
      // parabolic refinement between neighboring shifts, so the 4px step
      // doesn't show up as a visible stair-step in the measurement
      const e = (j) => errAt(prof, D.prof, j);
      const e0 = e(bestJ - 1);
      const e2 = e(bestJ + 1);
      let sub = 0;
      if (Number.isFinite(e0) && Number.isFinite(e2)) {
        const den = e0 - 2 * bestErr + e2;
        if (den > 0) sub = clamp((e0 - e2) / (2 * den), -1, 1);
      }
      const px = ((bestJ + sub) * PROF_STEP) / dt;
      D.px = lerp(D.px, clamp(px, 0, 140), 0.25);
    }
    D.prof = prof;
    D.at = now;
  }

  /** Line Y at an arbitrary X (css) — reads a narrow strip. */
  function yAt(cssX, cachedWin) {
    if (!S.line) return null;
    let win = cachedWin;
    let colBase;
    if (win && cssX * S.k >= win.sx && cssX * S.k < win.sx + win.w) {
      colBase = Math.round(cssX * S.k) - win.sx;
    } else {
      win = readWindow(cssX - 3, 7);
      if (!win) return null;
      colBase = Math.round(cssX * S.k) - win.sx;
    }
    for (const off of [0, 1, -1, 2, -2, 3, -3]) {
      const c = colBase + off;
      if (c < 0 || c >= win.w) continue;
      const y = yInColumn(win, c, S.line);
      if (y !== null) return y / S.k;
    }
    return null;
  }

  function findTip() {
    if (!S.range) return null;
    const y = yAt(S.range.x1);
    if (y === null) return null;
    const back = yAt(S.range.x1 - 16);
    return {
      x: S.range.x1,
      y,
      slope: back === null ? 0 : (y - back) / 16,
    };
  }

  /* ------------------------------------------------------------------ *
   *  Dust kicked up from the feet
   * ------------------------------------------------------------------ */

  function spawnDust(x, y, dir) {
    if (S.dust.length > 60) return;
    S.dust.push({
      x,
      y,
      vx: -dir * (16 + Math.random() * 26),
      vy: -8 - Math.random() * 14,
      r: 1.3 + Math.random() * 2.1,
      life: 1,
    });
  }

  function drawDust(ctx, dt) {
    for (let i = S.dust.length - 1; i >= 0; i--) {
      const p = S.dust[i];
      p.life -= dt * 1.9;
      if (p.life <= 0) {
        S.dust.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 26 * dt;
      ctx.globalAlpha = Math.max(0, p.life) * 0.45;
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function spawnSplash(x, y) {
    for (let i = 0; i < 10; i++) {
      S.splash.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 90,
        vy: -60 - Math.random() * 60,
        r: 1 + Math.random() * 1.6,
        life: 1,
      });
    }
  }

  function drawSplash(ctx, dt) {
    for (let i = S.splash.length - 1; i >= 0; i--) {
      const p = S.splash[i];
      p.life -= dt * 1.7;
      if (p.life <= 0) {
        S.splash.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      ctx.globalAlpha = Math.max(0, p.life) * 0.7;
      ctx.fillStyle = '#5fa8e0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function spawnGust(x, y) {
    if (S.gust.length > 50) return;
    S.gust.push({
      x: x + 30 + Math.random() * 70,
      y: y - 34 + Math.random() * 68,
      len: 12 + Math.random() * 20,
      vx: -(320 + Math.random() * 240),
      life: 1,
    });
  }

  function drawGust(ctx, dt) {
    for (let i = S.gust.length - 1; i >= 0; i--) {
      const g = S.gust[i];
      g.life -= dt * 1.6;
      if (g.life <= 0) {
        S.gust.splice(i, 1);
        continue;
      }
      g.x += g.vx * dt;
      ctx.globalAlpha = Math.max(0, g.life) * 0.5;
      ctx.strokeStyle = '#c7cbd6';
      ctx.lineWidth = 1.4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g.x - g.len, g.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ *
   *  Round behavior
   *
   *  A round is 5 min: falls from the sky at the start → cycles through
   *  "walk → run → rest" → 10s before the end, dashes to the tip and dives.
   *  The ground keeps scrolling left (measureDrift), so it's a treadmill:
   *  resting drifts the character back.
   * ------------------------------------------------------------------ */

  const B = {
    // full randomization: after each leg we pick the next action by
    // weight, so long streaks are possible (5 runs in a row and the like)
    actionWeights: { walk: 0.3, run: 0.45, rest: 0.25 },

    // roamHigh is no longer an artificial ceiling but nearly the whole
    // line; the character can genuinely reach the end, and that's exactly
    // what the wind below catches
    roamHigh: [0.9, 0.97],
    roamLow: [0.06, 0.18],
    walkFrac: [0.05, 0.11],
    runFrac: [0.09, 0.18],
    // pure on-screen gain, already net of scrolling
    walkPxPerSec: [22, 40],
    runPxPerSec: [70, 130],
    restBack: [0.9, 1.35], // fraction of the gain given back to the treadmill while resting
    restMaxSec: 16,
    calmBefore: 12, // sec before the end — stop moving forward
    sprintAt: 10, // sec before the end — final dash
    diveLead: 2, // sec before the end — should already be at the tip
    sprintMax: 900,
    tipMargin: 30,

    // reached almost the tip while the round isn't over yet — blows it back
    windMargin: 46, // px from the tip where the gust starts
    windPxPerSec: [340, 520],
    windTo: [0.05, 0.2], // where it carries the character to, fraction of line width

    hurdleEvery: [11, 22], // sec between hurdle spawns
    maxHurdles: 2,
    tripChance: 0.18,

    // character units (height = 50), not pixels — so scale doesn't break the jump
    jumpApex: 30,
    jumpG: 1400,
    jumpMinVx: 105,
    jumpJitter: [0.92, 1.1],

    stepClimb: 150, // climbing a sharp price move, units/sec
    stepHop: 22, // above this, hop instead of climbing
    hopCooldown: 700,
    stepMaxApex: 62,
    stepLook: 14,
    tripSec: [2.4, 3.4],

    gagEvery: [0.9, 2.4],
    gags: ['pant', 'peck', 'look', 'flap', 'scratch', 'peck'],
  };

  const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);

  /** Random next action by weight; excludeRest — not right after resting. */
  function pickNextAction(excludeRest) {
    const opts = excludeRest ? ['walk', 'run'] : ['walk', 'run', 'rest'];
    const weights = opts.map((o) => B.actionWeights[o]);
    let r = Math.random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < opts.length; i++) {
      r -= weights[i];
      if (r <= 0) return opts[i];
    }
    return opts[opts.length - 1];
  }

  /** Seconds left in the round; null if the timer wasn't found. */
  function roundSecondsLeft(t) {
    const R = S.round;
    if (!R.clockEl || !R.clockEl.isConnected) {
      R.clockEl = null;
      if (t - R.lookedAt < 1000) return null;
      R.lookedAt = t;
      for (const el of document.querySelectorAll('span,div,p')) {
        if (el.children.length) continue;
        if (!/^\d{1,2}:\d{2}$/.test((el.textContent || '').trim())) continue;
        const around = el.parentElement?.parentElement?.textContent || '';
        if (/ends\s*in/i.test(around)) {
          R.clockEl = el;
          break;
        }
      }
      if (!R.clockEl) return null;
    }
    const m = /^(\d{1,2}):(\d{2})$/.exec((R.clockEl.textContent || '').trim());
    return m ? +m[1] * 60 + +m[2] : null;
  }

  function beginFall(R) {
    R.state = 'fall';
    R.groundY = null;
    R.sprint = false;
    R.cycleGain = 0;
    R.cosmetic = pickCosmetic();
    S.hurdles.length = 0;
    S.puddles.length = 0;
    S.tumbleweeds.length = 0;
    R.dir = 1;
    R.x = S.range.x0 + 8 + Math.random() * 40;
    R.y = -PAD * 0.9;
    R.vy = 0;
    R.angle = 0;
    R.alive = true;
  }

  const MIN_LEG = 25; // less than this — don't bother, rest right away

  const span = () => Math.max(1, S.range.x1 - S.range.x0);
  const atFrac = (f) => S.range.x0 + span() * f;

  /** Shared start of a forward leg. Rests instead if there's nowhere to go. */
  function beginLeg(R, state, frac, speed) {
    const ceiling = Math.min(atFrac(rnd(B.roamHigh)), S.range.x1 - B.tipMargin);
    const goal = Math.min(R.x + span() * rnd(frac), ceiling);
    // don't push forward near the end of the round — leave room for the dash
    const calm = S.round.prev !== null && S.round.prev <= B.calmBefore;
    if (calm || goal - R.x < MIN_LEG) {
      beginRest(R);
      return;
    }
    R.state = state;
    R.dir = 1;
    R.baseSpeed = rnd(speed);
    R.goal = goal;
  }

  function beginWalk(R) {
    beginLeg(R, 'walk', B.walkFrac, B.walkPxPerSec);
  }

  function beginRun(R) {
    beginLeg(R, 'run', B.runFrac, B.runPxPerSec);
  }

  function beginRest(R) {
    R.state = 'rest';
    R.dir = 1;
    R.gag = 'pant';
    R.gagT = performance.now() + rnd(B.gagEvery) * 1000;
    // rest until the treadmill carries back what was just gained — a self-balancing cycle
    R.restTo = Math.max(R.x - R.cycleGain * rnd(B.restBack), atFrac(rnd(B.roamLow)));
    R.cycleGain = 0;
    R.rest = B.restMaxSec;
  }

  function beginSprint(R) {
    R.state = 'run';
    R.sprint = true;
    R.dir = 1;
    R.goal = S.range.x1;
    R.baseSpeed = 200; // recomputed every frame
  }

  function beginDive(R) {
    R.state = 'dive';
    R.vx = 26 + Math.random() * 26; // nearly vertical, like diving into water
    R.vy = -120;
  }

  function beginWind(R) {
    R.state = 'wind';
    R.dir = 1; // still 'running' forward, just being carried back
    R.speed = rnd(B.windPxPerSec);
    R.goal = atFrac(rnd(B.windTo));
    R.cycleGain = 0;
    // The gust is faster than the treadmill drift (300-500 vs ~20-60 px/s),
    // so the character overtakes hurdles it already cleared and ends up in
    // front of them again — but they're marked done, and hurdleAhead just
    // ignores them. Clearing everything, same as a new round, is more
    // honest than adding logic to "re-unlock" them.
    S.hurdles.length = 0;
    S.puddles.length = 0;
    S.tumbleweeds.length = 0;
    for (let i = 0; i < 8; i++) spawnGust(R.x, R.y);
  }

  /* ------------------------------------------------------------------ *
   *  Hurdles
   * ------------------------------------------------------------------ */

  // Make sure no two of {hurdle, puddle, tumbleweed} ever land on the same
  // spot: check all three arrays before every spawn, not just your own.
  const SPAWN_GAP = 70;

  function spawnClear(x) {
    for (const h of S.hurdles) if (Math.abs(h.x - x) < SPAWN_GAP) return false;
    for (const p of S.puddles) if (Math.abs(p.x - x) < SPAWN_GAP) return false;
    for (const w of S.tumbleweeds) if (Math.abs(w.x - x) < SPAWN_GAP) return false;
    return true;
  }

  function updateHurdles(dt, t, active) {
    if (active && t > S.nextHurdle) {
      const x = S.range.x1 - 6;
      if (!spawnClear(x)) {
        S.nextHurdle = t + 600; // spot's taken — try again shortly
      } else {
        S.nextHurdle = t + rnd(B.hurdleEvery) * 1000;
        if (S.hurdles.length < B.maxHurdles) {
          S.hurdles.push({
            x,
            y: 0,
            angle: 0,
            knock: 0,
            lie: 0,
            alpha: 1,
            done: false,
            tint: Math.random(),
          });
        }
      }
    }
    const resample = t - S.hurdlesAt > 100;
    if (resample) S.hurdlesAt = t;
    for (let i = S.hurdles.length - 1; i >= 0; i--) {
      const h = S.hurdles[i];
      h.x -= S.drift.px * dt;
      if (h.knock > 0 && h.knock < 1) {
        h.knock = Math.min(1, h.knock + dt * 4);
        if (h.knock >= 1) h.lie = 2.4;
      }
      if (h.lie > 0) {
        h.lie -= dt;
      } else if (h.knock >= 1) {
        h.alpha = (h.alpha ?? 1) - dt * 1.4;
        if (h.alpha <= 0) {
          S.hurdles.splice(i, 1);
          continue;
        }
      }
      if (resample) {
        const y = yAt(h.x);
        if (y !== null) h.y = y;
        const a = yAt(h.x - 6);
        const b = yAt(h.x + 6);
        h.angle = a !== null && b !== null ? clamp(Math.atan((b - a) / 12), -0.7, 0.7) : 0;
      }
      if (h.x < S.range.x0 - 40) S.hurdles.splice(i, 1);
    }
  }

  /** Nearest hurdle ahead; null if there is none. */
  function hurdleAhead(R) {
    let best = null;
    for (const h of S.hurdles) {
      if (h.done || h.knock) continue;
      const d = h.x - R.x;
      if (d < -6 || d > 260) continue;
      if (!best || d < best.d) best = { h, d };
    }
    return best;
  }

  /** Pixels per character unit at the current scale. */
  const unitPx = () => 0.78 * (cfg.scale || 1);

  // The takeoff distance depends on the closing speed (~45px/s walking,
  // up to 540 during the dash), so we compute it so the top of the arc
  // lands right on the hurdle — instead of using a fixed distance.
  function jumpPlan(R, needPx) {
    const u = unitPx();
    const g = B.jumpG * u;
    const apex = clamp(
      Math.max(B.jumpApex * u, (needPx || 0) + 12 * u),
      B.jumpApex * u,
      B.stepMaxApex * u
    );
    const v = Math.sqrt(2 * g * apex);
    const T = (2 * v) / g;
    const vx = Math.max(R.state === 'rest' ? 0 : R.speed, B.jumpMinVx * u);
    return { v, g, vx, at: (vx + S.drift.px) * T * 0.5 };
  }

  /** How sharply the line rises right in front of the character, in pixels. */
  function wallAhead(R) {
    if (R.groundY === null) return 0;
    const g1 = yAt(R.x + B.stepLook);
    return g1 === null ? 0 : R.groundY - g1;
  }

  function beginJump(R, plan) {
    R.resume = R.state;
    R.state = 'jump';
    R.jumpOff = 0;
    R.jumpV = -plan.v;
    R.jumpG = plan.g;
    R.jumpVx = plan.vx;
    R.dir = 1;
  }

  function beginTrip(R, h) {
    R.state = 'trip';
    R.dir = 1;
    R.tripT = rnd(B.tripSec);
    R.tripTotal = R.tripT;
    R.tripPhase = 'trip';
    R.jumpOff = 0;
    if (h) h.knock = 0.01;
    for (let i = 0; i < 5; i++) spawnDust(R.x + 4, R.y, 1);
  }

  /** Hurdle ahead: jump or fall. true — the state changed. */
  function tryHurdle(R) {
    const ahead = hurdleAhead(R);
    if (!ahead) return false;
    const h = ahead.h;
    if (h.trap === undefined) {
      h.trap = !R.sprint && Math.random() < B.tripChance;
      h.jitter = rnd(B.jumpJitter);
    }
    if (ahead.d <= 9) {
      beginTrip(R, h);
      return true;
    }
    if (h.trap) return false;
    const plan = jumpPlan(R);
    if (ahead.d <= plan.at * h.jitter) {
      h.done = true;
      beginJump(R, plan);
      return true;
    }
    return false;
  }

  function pickGag(R, t) {
    R.gag = B.gags[(Math.random() * B.gags.length) | 0];
    R.gagT = t + rnd(B.gagEvery) * 1000;
    R.phase = 0;
  }

  /* ------------------------------------------------------------------ *
   *  Small line events — purely decorative, don't touch the state machine
   * ------------------------------------------------------------------ */

  const ATMO = {
    puddleEvery: [9, 16],
    puddleW: [26, 46],
    tumbleEvery: [22, 40],
  };

  function updatePuddles(dt, t, R, active) {
    if (active && t > S.nextPuddle) {
      const x = S.range.x1 - 6;
      if (!spawnClear(x)) {
        S.nextPuddle = t + 600;
      } else {
        S.nextPuddle = t + rnd(ATMO.puddleEvery) * 1000;
        S.puddles.push({ x, y: 0, w: rnd(ATMO.puddleW), hit: false });
      }
    }
    for (let i = S.puddles.length - 1; i >= 0; i--) {
      const p = S.puddles[i];
      p.x -= S.drift.px * dt;
      const y = yAt(p.x);
      if (y !== null) p.y = y;
      if (
        !p.hit &&
        (R.state === 'walk' || R.state === 'run') &&
        Math.abs(R.x - p.x) < p.w * 0.35
      ) {
        p.hit = true;
        spawnSplash(R.x, R.y);
      }
      if (p.x < S.range.x0 - 40) S.puddles.splice(i, 1);
    }
  }

  function updateTumbleweeds(dt, t, active) {
    if (active && t > S.nextTumble && S.tumbleweeds.length < 1) {
      const x = S.range.x1 + 20;
      if (!spawnClear(x)) {
        S.nextTumble = t + 600;
      } else {
        S.nextTumble = t + rnd(ATMO.tumbleEvery) * 1000;
        S.tumbleweeds.push({ x, y: 0, angle: 0, r: 8 + Math.random() * 5 });
      }
    }
    for (let i = S.tumbleweeds.length - 1; i >= 0; i--) {
      const w = S.tumbleweeds[i];
      // Same drift as hurdles/puddles — otherwise the faster tumbleweed
      // catches up to them AFTER a clean spawn (SPAWN_GAP doesn't catch
      // this, since it only checks the moment of spawning, not later
      // movement).
      w.x -= S.drift.px * dt;
      w.angle -= S.drift.px * dt / Math.max(4, w.r);
      const y = yAt(w.x);
      if (y !== null) w.y = y - w.r * 0.6;
      if (w.x < S.range.x0 - 60) S.tumbleweeds.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Cosmetics: a per-round chance at an accessory
   * ------------------------------------------------------------------ */

  function pickCosmetic() {
    const r = Math.random();
    if (r < 0.12) return 'shades';
    if (r < 0.24) return 'flower';
    return null;
  }

  function updateCycle(dt, t) {
    const R = S.runner;
    const left = roundSecondsLeft(t);

    // the timer jumped up — new round
    if (left !== null && S.round.prev !== null && left > S.round.prev + 5) {
      beginFall(R);
    }
    if (left !== null) S.round.prev = left;

    if (!R.alive) beginFall(R);

    // safety net: didn't make it in time and the round is ending — dive from wherever
    if (left !== null && left <= 1 && R.sprint && R.state !== 'dive' && R.state !== 'gone') {
      beginDive(R);
    }

    if (
      left !== null &&
      left <= B.sprintAt &&
      !R.sprint &&
      R.state !== 'dive' &&
      R.state !== 'gone' &&
      R.state !== 'fall' &&
      R.state !== 'jump'
    ) {
      beginSprint(R);
    }

    const calmPhase =
      R.state === 'dive' || R.state === 'gone' || R.state === 'fall' || R.state === 'wind';
    updateHurdles(dt, t, !calmPhase && !R.sprint);
    updatePuddles(dt, t, R, !calmPhase && !R.sprint);
    updateTumbleweeds(dt, t, !calmPhase && !R.sprint);

    switch (R.state) {
      case 'jump': {
        R.jumpV += R.jumpG * dt;
        R.jumpOff += R.jumpV * dt;
        R.x += R.jumpVx * dt;
        R.cycleGain += R.jumpVx * dt;

        // land where the arc actually crosses the line (not at takeoff
        // height — otherwise it could never climb a step up); jumpV > 0
        // rules out a false landing on a dt = 0 frame
        const gLand = yAt(R.x);
        const yNow = R.groundY + R.jumpOff;
        const landed = gLand !== null ? yNow >= gLand : R.jumpOff >= 0;
        if (R.jumpV > 0 && landed) {
          if (gLand !== null) R.groundY = gLand;
          R.jumpOff = 0;
          R.vFall = 0;
          spawnDust(R.x - 3, R.y, 1);
          R.state = R.resume; // back to whatever state we jumped from

          // Any hurdle the arc flew over but that wasn't the one this jump
          // targeted (e.g. a second hurdle, or a jump triggered by a terrain
          // wall) is now behind the feet. Left unmarked, the very next frame
          // sees it as "just ahead" (hurdleAhead tolerates a few px behind)
          // and instantly trips into it — reading as the character
          // teleporting onto an obstacle it had already cleared in the air.
          for (const h of S.hurdles) {
            if (!h.done && !h.knock && h.x <= R.x + 6) h.done = true;
          }
        }
        break;
      }

      case 'trip': {
        R.x -= S.drift.px * dt;
        R.tripT -= dt;
        const gone = R.tripTotal - R.tripT;
        R.tripPhase = gone < 0.45 ? 'trip' : R.tripT > 0.8 ? 'hurt' : 'rise';
        if (R.tripT <= 0) beginWalk(R);
        break;
      }

      case 'fall': {
        R.vy += 900 * dt;
        R.y += R.vy * dt;
        const ground = yAt(R.x);
        if (ground !== null && R.y >= ground) {
          R.y = ground;
          R.groundY = ground;
          R.vFall = 0;
          for (let i = 0; i < 6; i++) spawnDust(R.x, R.y, i % 2 ? 1 : -1);
          beginWalk(R);
        } else if (R.y > S.css.h + PAD) {
          beginWalk(R);
        }
        break;
      }

      case 'dive': {
        R.vy += 900 * dt;
        R.x += R.vx * dt;
        R.y += R.vy * dt;
        if (R.y > S.css.h + PAD) R.state = 'gone';
        break;
      }

      case 'gone':
        break;

      case 'wind': {
        R.x -= R.speed * dt;
        if (Math.random() < dt * 16) spawnGust(R.x + 30, R.y);
        if (R.x <= R.goal) {
          R.x = R.goal;
          beginWalk(R);
        }
        break;
      }

      case 'rest': {
        R.x -= S.drift.px * dt;
        R.rest -= dt;
        if (t > R.gagT) pickGag(R, t);
        if (tryHurdle(R)) break;
        if (R.x <= R.restTo || R.rest <= 0) {
          if (pickNextAction(true) === 'run') beginRun(R);
          else beginWalk(R);
        }
        break;
      }

      default: {
        // walk | run
        if (R.sprint) {
          // speed is tuned to arrive at the tip right at the end
          const timeLeft = Math.max(0.8, (left ?? B.sprintAt) - B.diveLead);
          R.speed = clamp((S.range.x1 - R.x) / timeLeft, 60, B.sprintMax);
        } else {
          R.speed = R.baseSpeed * cfg.speed;
        }
        // slope doesn't slow the dash — otherwise it couldn't make it in 10s
        const eff = R.sprint
          ? R.speed
          : R.speed * clamp(1 + S.slope * 0.45, 0.55, 1.5);
        R.x += eff * dt;
        R.cycleGain += eff * dt;

        // bail out immediately if the state changed — otherwise the goal
        // check below would switch to resting mid-air
        if (tryHurdle(R)) break;

        // only jump a wall we can actually clear; climb anything taller,
        // or we'd get stuck hopping in place forever in front of it
        const u = unitPx();
        const wall = wallAhead(R);
        if (
          wall > B.stepHop * u &&
          wall < (B.stepMaxApex - 10) * u &&
          t > R.hopAt
        ) {
          R.hopAt = t + B.hopCooldown;
          beginJump(R, jumpPlan(R, wall));
          break;
        }

        // reached almost the tip while the round isn't over yet — wind kicks in
        if (!R.sprint && R.x >= S.range.x1 - B.windMargin) {
          beginWind(R);
          break;
        }

        if (R.x >= R.goal) {
          R.x = R.goal;
          if (R.sprint) {
            beginDive(R);
          } else {
            const next = pickNextAction(false);
            if (next === 'run') beginRun(R);
            else if (next === 'walk') beginWalk(R);
            else beginRest(R);
          }
        }
        break;
      }
    }

    if (R.state === 'gone') return;

    if (R.state !== 'dive') R.x = clamp(R.x, S.range.x0, S.range.x1);

    const span = Math.max(1, S.range.x1 - S.range.x0);
    R.pct = ((R.x - S.range.x0) / span) * 100;

    if (R.state !== 'fall' && R.state !== 'dive') {
      // ground height isn't taken instantly but smoothed: we fall or climb
      // instead of snapping to a new height on a sharp price move. During a
      // jump the level is frozen at the takeoff point.
      const g = yAt(R.x);
      if (g !== null && R.state !== 'jump') {
        const u = unitPx();
        if (R.groundY === null) R.groundY = g;
        const d = g - R.groundY;
        if (Math.abs(d) < 1.2) {
          R.groundY = g;
          R.vFall = 0;
        } else if (d > 0) {
          R.vFall += B.jumpG * u * dt;
          R.groundY = Math.min(g, R.groundY + R.vFall * dt);
          if (R.groundY >= g) R.vFall = 0;
        } else {
          R.groundY = Math.max(g, R.groundY - B.stepClimb * u * dt);
          R.vFall = 0;
        }
      }
      if (R.groundY === null && g !== null) R.groundY = g;
      if (R.groundY !== null) {
        R.y = R.groundY + (R.state === 'jump' ? R.jumpOff : 0);
      }
    }
    const yb = yAt(R.x - 7);
    const yf = yAt(R.x + 7);
    if (yb !== null && yf !== null) S.slope = (yf - yb) / 14;
  }

  /* ------------------------------------------------------------------ *
   *  Main loop
   * ------------------------------------------------------------------ */

  function frame(t) {
    S.raf = requestAnimationFrame(frame);
    const dt = S.lastT ? Math.min(0.05, (t - S.lastT) / 1000) : 0.016;
    S.lastT = t;

    if (!S.overlay || !S.octx || !S.src) return;
    if (!S.src.isConnected) {
      detach();
      return;
    }

    const ctx = S.octx;
    ctx.setTransform(S.dpr, 0, 0, S.dpr, PAD * S.dpr, PAD * S.dpr);
    ctx.clearRect(-PAD, -PAD, S.css.w + PAD * 2, S.css.h + PAD * 2);
    if (!cfg.enabled) return;

    drawClouds(ctx, dt);

    if (!S.line && t - S.lineFoundAt > 700) {
      S.lineFoundAt = t;
      S.line = detectLineColor();
      if (S.line) {
        S.status = 'ok';
        S.reason = '';
        if (cfg.debug) console.log(TAG, 'line color', S.line);
      } else if (S.status !== 'error') {
        S.status = 'searching';
        S.reason = "the line isn't visible on the chart yet";
      }
    }
    if (!S.line) return;

    const R = S.runner;

    if (t - S.lastRangeScan > 400 || !S.range) {
      S.lastRangeScan = t;
      const r = scanRange();
      if (!r) {
        S.line = null;
        S.range = null;
        S.tip = null;
        return;
      }
      S.range = r;
    }

    if (cfg.mode === 'tip') {
      if (t - S.lastScan > 90) {
        S.lastScan = t;
        const tip = findTip();
        if (!tip) {
          S.tip = null;
          return;
        }
        S.tip = tip;
        S.slope = tip.slope;
      }
      if (!S.tip) return;
      if (!R.alive) {
        R.x = S.tip.x;
        R.y = S.tip.y;
        R.alive = true;
      }
      R.state = 'run';
      R.dir = 1;
      R.speed = 70 * cfg.speed;
      R.x = lerp(R.x, S.tip.x, 1 - Math.pow(0.001, dt));
      R.y = lerp(R.y, S.tip.y, 1 - Math.pow(0.001, dt));
    } else {
      updateCycle(dt, t);
    }

    let targetAngle;
    let snap = 0.002;
    if (R.state === 'dive') {
      // the head points exactly along the velocity vector: θ = atan2(vx, -vy)
      targetAngle = clamp(Math.atan2(R.vx, -R.vy), -0.7, 3.0);
      snap = 0.02;
    } else if (R.state === 'fall') {
      targetAngle = Math.sin(t / 170) * 0.12;
      snap = 0.02;
    } else if (R.state === 'trip') {
      targetAngle =
        R.tripPhase === 'rise' ? clamp(Math.atan(S.slope), -0.7, 0.7) : 1.45;
      snap = R.tripPhase === 'trip' ? 0.0004 : 0.006;
    } else {
      targetAngle = clamp(Math.atan(S.slope), -0.7, 0.7);
    }
    R.angle = lerp(R.angle, targetAngle, 1 - Math.pow(snap, dt));

    if (R.state === 'walk' || R.state === 'run') {
      const ground = R.speed + S.drift.px;
      const cad = R.state === 'run' ? 0.13 * ground + 5 : 0.22 * ground + 2.5;
      const prev = R.phase;
      R.phase += cad * dt;
      const step = Math.floor(prev / Math.PI) !== Math.floor(R.phase / Math.PI);
      if (step && (R.state === 'run' || Math.random() < 0.5)) {
        spawnDust(R.x - 3 * R.dir, R.y + 1, R.dir);
      }
    } else if (R.state === 'fall') {
      R.phase += 20 * dt;
    } else if (R.state === 'trip') {
      R.phase += (R.tripPhase === 'hurt' ? 3 : 14) * dt;
    } else if (R.state === 'wind') {
      R.phase += 24 * dt; // running in place while the wind carries it back
    } else if (R.state === 'rest') {
      const sp = { peck: 7, look: 1.6, flap: 9, scratch: 8 }[R.gag] || 0;
      R.phase += sp * dt;
    }

    drawDust(ctx, dt);
    drawSplash(ctx, dt);
    drawGust(ctx, dt);
    for (const p of S.puddles) {
      window.XOChicken.drawPuddle(ctx, { x: p.x, y: p.y, w: p.w });
    }
    for (const w of S.tumbleweeds) {
      window.XOChicken.drawTumbleweed(ctx, { x: w.x, y: w.y, angle: w.angle, r: w.r });
    }
    for (const h of S.hurdles) {
      window.XOChicken.drawHurdle(ctx, {
        x: h.x,
        y: h.y,
        angle: h.angle,
        knock: h.knock,
        alpha: h.alpha,
        scale: cfg.scale,
        tint: h.tint,
      });
    }
    if (R.state === 'gone') return;
    if (R.groundY !== null && R.state !== 'fall' && R.state !== 'dive') {
      const height = R.state === 'jump' ? -R.jumpOff : 0;
      window.XOChicken.drawShadow(ctx, R.x, R.groundY, height, cfg.scale);
    }
    const shown =
      R.state === 'trip'
        ? R.tripPhase
        : R.state === 'rest' && R.gag !== 'pant'
          ? R.gag
          : R.state;
    window.XOChicken.draw(ctx, {
      x: R.x,
      y: R.y,
      dir: R.dir,
      state: shown,
      phase: R.phase,
      t: t / 1000,
      scale: cfg.scale,
      angle: R.angle,
      cosmetic: R.cosmetic,
    });

    if (cfg.debug && S.range) {
      ctx.fillStyle = 'rgba(255,0,0,0.8)';
      ctx.fillRect(R.x - 1, R.y - 1, 3, 3);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.font = '10px monospace';
      ctx.fillText(
        `${R.state}${R.sprint ? '(sprint)' : ''} x=${R.x.toFixed(0)} ` +
          `goal=${R.goal.toFixed(0)} tip=${S.range.x1.toFixed(0)} ` +
          `drift=${S.drift.px.toFixed(1)}px/s left=${S.round.prev ?? '?'}s`,
        S.range.x0 + 4,
        14
      );
    }
  }

  /* ------------------------------------------------------------------ *
   *  Watching the DOM / SPA navigation
   * ------------------------------------------------------------------ */

  // The page constantly churns the DOM (price tickers), so a debounced
  // MutationObserver would never settle — we poll on a timer instead.
  function watch() {
    const c = findChartCanvas();
    if (c && c !== S.src) attach(c);
    else if (!c && S.src) detach();
  }

  setInterval(watch, 800);
  window.addEventListener('resize', syncSize);
  watch();
  S.raf = requestAnimationFrame(frame);

  /* ------------------------------------------------------------------ *
   *  Settings
   * ------------------------------------------------------------------ */

  // for debugging from the console; in the extension, DevTools runs a
  // separate context — switch the dropdown at the top of the console to
  // "XO Pulse Runner"
  window.__xoRunnerCfg = cfg;
  window.__xoRunnerState = S;

  const ext =
    typeof chrome !== 'undefined' && chrome.storage && chrome.runtime
      ? chrome
      : null;
  if (!ext) return;

  ext.storage.sync.get(DEFAULTS, (v) => {
    cfg = { ...DEFAULTS, ...v };
    S.line = null;
    S.runner.alive = false;
  });

  ext.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const modeChanged = 'mode' in changes || 'lineColor' in changes;
    for (const [k, { newValue }] of Object.entries(changes)) cfg[k] = newValue;
    S.line = null;
    S.range = null;
    if (modeChanged) S.runner.alive = false;
  });

  ext.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === 'xo-runner-status') {
      reply({
        status: S.src ? S.status : 'no-chart',
        reason: S.reason,
        line: S.line,
        tip: S.tip,
      });
    }
    return true;
  });
})();
