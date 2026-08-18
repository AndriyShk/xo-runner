/*
 * XO Pulse Runner — малює персонажа поверх лінії графіка на xo.market/pulse.
 * Читає пікселі canvas графіка, нічого на сторінці не змінює.
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
    src: null, // canvas графіка
    scratch: null, // власний буфер, куди копіюємо смуги для читання
    sctx: null,
    overlay: null,
    octx: null,
    ro: null,
    raf: 0,
    k: 1, // backing-пікселів на 1 css-піксель у canvas графіка
    css: { w: 0, h: 0 },
    dpr: 1,
    line: null, // {r,g,b} — колір лінії
    lineFoundAt: 0,
    lastScan: 0,
    lastRangeScan: 0,
    range: null, // {x0, x1} — межі лінії по X, css
    tip: null, // {x, y} css
    slope: 0,
    runner: {
      alive: false,
      pct: 50, // позиція вздовж лінії, %
      x: 0,
      y: 0,
      dir: 1, // 1 — дивиться праворуч, -1 — ліворуч
      state: 'run', // 'run' | 'walk' | 'rest'
      target: 90, // куди прямує, %
      rest: 0, // скільки ще відпочивати, сек
      baseSpeed: 70, // px/сек до множника темпу
      speed: 70,
      goal: 0, // до якого X іде цей відрізок
      restTo: 0, // до якого X має віднести доріжка на відпочинку
      cycleGain: 0, // скільки набув уперед від минулого відпочинку
      resume: 'walk', // куди повернутись після стрибка
      jumpOff: 0, // висота над лінією під час стрибка
      jumpV: 0,
      jumpG: 1400,
      jumpVx: 0, // горизонтальна швидкість у стрибку
      groundY: null, // згладжена висота землі під лапами
      vFall: 0, // швидкість падіння, коли земля пішла з-під ніг
      hopAt: 0, // не стрибати через стінку частіше, ніж раз на hopCooldown
      tripT: 0, // скільки ще лежати
      tripTotal: 0,
      tripPhase: 'trip', // 'trip' | 'hurt' | 'rise'
      gag: 'pant', // що робить під час відпочинку
      gagT: 0,
      cosmetic: null, // 'shades' | 'flower' | null, задається на кожен раунд
      sprint: false, // фінальний ривок перед кінцем раунду
      vx: 0,
      vy: 0,
      phase: 0,
      angle: 0,
    },
    drift: { px: 20, prof: null, at: 0 }, // швидкість прокрутки графіка, px/сек
    hurdles: [], // {x, y, knock, done}
    nextHurdle: 0, // коли з'явиться наступна
    hurdlesAt: 0, // коли востаннє перерахували їх висоту
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

  const PAD = 64; // запас навколо графіка, щоб персонаж не обрізався об край

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ------------------------------------------------------------------ *
   *  Пошук canvas графіка
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

    // оверлей більший за графік на PAD з кожного боку, щоб персонажа не обрізало
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

  function drawClouds(ctx, dt) {
    for (const c of S.clouds) {
      c.x -= c.speed * dt;
      if (c.x < -c.r * 3) c.x = S.css.w + c.r * 3;
      // Білий на білому фоні графіка (майже завжди такий) невидимий навіть
      // із товщиною — потрібен колір, що контрастує з фоном, а не сам alpha.
      ctx.fillStyle = 'rgba(196, 214, 240, 0.6)';
      ctx.strokeStyle = 'rgba(150, 176, 214, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r, c.r * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - c.r * 0.6, c.y + c.r * 0.12, c.r * 0.62, c.r * 0.4, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + c.r * 0.65, c.y + c.r * 0.1, c.r * 0.55, c.r * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /* ------------------------------------------------------------------ *
   *  Читання пікселів
   * ------------------------------------------------------------------ */

  // Копіюємо смугу чужого canvas у свій буфер, а не читаємо напряму: перший
  // getContext() на чужому canvas фіксує його тип, і якщо бібліотека графіка
  // згодом попросить WebGL — отримає null. drawImage такого обмеження не має.
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
      S.reason = 'не вдається прочитати canvas графіка: ' + e.message;
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

  /** Y лінії в конкретній колонці вікна (backing-координати) або null. */
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
    // товста «стіна» пікселів — це заливка під лінією, а не сама лінія
    if (bestLen === 0 || bestLen > 14 * S.k) return null;
    return best;
  }

  /* ------------------------------------------------------------------ *
   *  Автовизначення кольору лінії
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
        if (mx < 45) continue; // осі й підписи
        if ((mx - mn) / mx < 0.3) continue; // сіре/біле
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

    // лінія — тонка (кілька пікселів у колонці) і тягнеться по X
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
   *  Пошук вістря лінії та нахилу
   * ------------------------------------------------------------------ */

  // Праворуч від кінця лінії сайт малює підпис ціни тим самим кольором, тому
  // беремо найдовший суцільний сегмент, а не крайні пікселі кольору.
  const MAX_GAP = 4; // css-пікселів розриву, який ще вважаємо тією ж лінією

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
   *  Швидкість «бігової доріжки»
   * ------------------------------------------------------------------ */

  // Вістря лінії прибите до фіксованого X, земля під ним їде вліво. Швидкість
  // прокрутки міряємо самі: знімаємо профіль висот лінії й шукаємо, на скільки
  // він з'їхав відтоді (взаємна кореляція).
  const PROF_STEP = 4; // css-пікселів між замірами
  const PROF_SPAN = 320; // ширина ділянки зліва від вістря

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

  /** Середньоквадратична розбіжність профілів при зсуві на j кроків. */
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

    // те, що зараз у точці i, раніше було правіше — у точці i + j
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
      // параболічне уточнення між сусідніми зсувами, щоб крок 4px не давав
      // помітної сходинки у вимірі
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

  /** Y лінії в довільному X (css) — читає вузьку смужку. */
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
   *  Пилюка з-під лап
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
   *  Поведінка на раунд
   *
   *  Раунд 5 хв: падіння з неба на старті → цикл «йде → біжить → відпочиває»
   *  → за 10с до кінця ривок до вістря і стрибок щучкою. Земля весь час їде
   *  вліво (measureDrift), тому це бігова доріжка: на відпочинку персонажа
   *  зносить назад.
   * ------------------------------------------------------------------ */

  const B = {
    // повна рандомізація: після кожного відрізка вибираємо наступну дію за
    // вагами, тож можливі довгі серії (5 бігів підряд і подібне)
    actionWeights: { walk: 0.3, run: 0.45, rest: 0.25 },

    // roamHigh — вже не штучна стеля, а майже все вістря; персонаж може
    // реально дійти до кінця, і саме це ловить вітер нижче
    roamHigh: [0.9, 0.97],
    roamLow: [0.06, 0.18],
    walkFrac: [0.05, 0.11],
    runFrac: [0.09, 0.18],
    // чистий приріст на екрані, вже без прокрутки
    walkPxPerSec: [22, 40],
    runPxPerSec: [70, 130],
    restBack: [0.9, 1.35], // частка набутого, яку віддаємо доріжці на відпочинку
    restMaxSec: 16,
    calmBefore: 12, // с до кінця — перестаємо просуватись уперед
    sprintAt: 10, // с до кінця — фінальний ривок
    diveLead: 2, // с до кінця — маємо вже стояти на вістрі
    sprintMax: 900,
    tipMargin: 30,

    // добіг майже до вістря, а раунд ще не закінчується — здуває назад
    windMargin: 46, // px від вістря, де стартує порив
    windPxPerSec: [340, 520],
    windTo: [0.05, 0.2], // куди відносить, частка ширини лінії

    hurdleEvery: [11, 22], // с між появами бар'єрів
    maxHurdles: 2,
    tripChance: 0.18,

    // одиниці персонажа (зріст = 50), не пікселі — щоб масштаб не ламав стрибок
    jumpApex: 30,
    jumpG: 1400,
    jumpMinVx: 105,
    jumpJitter: [0.92, 1.1],

    stepClimb: 150, // видряпування на різкий рух ціни, од/сек
    stepHop: 22, // вище — стрибок замість видряпування
    hopCooldown: 700,
    stepMaxApex: 62,
    stepLook: 14,
    tripSec: [2.4, 3.4],

    gagEvery: [0.9, 2.4],
    gags: ['pant', 'peck', 'look', 'flap', 'scratch', 'peck'],
  };

  const rnd = (r) => r[0] + Math.random() * (r[1] - r[0]);

  /** Випадкова наступна дія за вагами; excludeRest — не одразу після відпочинку. */
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

  /** Скільки секунд лишилось у раунді; null, якщо таймер не знайдено. */
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

  const MIN_LEG = 25; // менше — не рушаємо, одразу відпочинок

  const span = () => Math.max(1, S.range.x1 - S.range.x0);
  const atFrac = (f) => S.range.x0 + span() * f;

  /** Спільний старт відрізка вперед. Якщо йти нікуди — переходить у відпочинок. */
  function beginLeg(R, state, frac, speed) {
    const ceiling = Math.min(atFrac(rnd(B.roamHigh)), S.range.x1 - B.tipMargin);
    const goal = Math.min(R.x + span() * rnd(frac), ceiling);
    // перед кінцем раунду вперед не лізем — лишаємо місце на ривок
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
    // відпочиваємо, поки доріжка не відвезе назад набуте — самобалансний цикл
    R.restTo = Math.max(R.x - R.cycleGain * rnd(B.restBack), atFrac(rnd(B.roamLow)));
    R.cycleGain = 0;
    R.rest = B.restMaxSec;
  }

  function beginSprint(R) {
    R.state = 'run';
    R.sprint = true;
    R.dir = 1;
    R.goal = S.range.x1;
    R.baseSpeed = 200; // перерахується щокадру
  }

  function beginDive(R) {
    R.state = 'dive';
    R.vx = 26 + Math.random() * 26; // майже вертикально, як у воду
    R.vy = -120;
  }

  function beginWind(R) {
    R.state = 'wind';
    R.dir = 1; // все ще «біжить» уперед, просто зносить назад
    R.speed = rnd(B.windPxPerSec);
    R.goal = atFrac(rnd(B.windTo));
    R.cycleGain = 0;
    // Порив швидший за дрейф доріжки (300-500 проти ~20-60 px/с), тому
    // персонаж обганяє вже пройдені бар'єри й опиняється перед ними знову —
    // а вони позначені done і hurdleAhead їх просто ігнорує. Прибираємо все,
    // як на новому раунді: чесніше, ніж плодити логіку повторного «розблокування».
    S.hurdles.length = 0;
    S.puddles.length = 0;
    S.tumbleweeds.length = 0;
    for (let i = 0; i < 8; i++) spawnGust(R.x, R.y);
  }

  /* ------------------------------------------------------------------ *
   *  Перешкоди
   * ------------------------------------------------------------------ */

  function updateHurdles(dt, t, active) {
    if (active && t > S.nextHurdle) {
      S.nextHurdle = t + rnd(B.hurdleEvery) * 1000;
      if (S.hurdles.length < B.maxHurdles) {
        S.hurdles.push({
          x: S.range.x1 - 6, y: 0, angle: 0,
          knock: 0, lie: 0, alpha: 1, done: false,
        });
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

  /** Найближчий бар'єр попереду; null, якщо таких немає. */
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

  /** Скільки пікселів в одній одиниці персонажа за поточного масштабу. */
  const unitPx = () => 0.78 * (cfg.scale || 1);

  // Дистанція відштовхування залежить від швидкості зближення (на ходьбі
  // ~45px/с, у ривку до 540), тому рахуємо так, щоб верхівка дуги припала
  // рівно на бар'єр — а не беремо сталу відстань.
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

  /** Наскільки різко лінія йде вгору просто перед персонажем, у пікселях. */
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

  /** Бар'єр попереду: стрибок або падіння. true — стан змінився. */
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
   *  Дрібні події на лінії — суто декоративні, стейт-машину не чіпають
   * ------------------------------------------------------------------ */

  const ATMO = {
    puddleEvery: [9, 16],
    puddleW: [26, 46],
    tumbleEvery: [22, 40],
    tumbleSpeedExtra: [10, 40],
  };

  function updatePuddles(dt, t, R, active) {
    if (active && t > S.nextPuddle) {
      S.nextPuddle = t + rnd(ATMO.puddleEvery) * 1000;
      S.puddles.push({ x: S.range.x1 - 6, y: 0, w: rnd(ATMO.puddleW), hit: false });
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
      S.nextTumble = t + rnd(ATMO.tumbleEvery) * 1000;
      S.tumbleweeds.push({ x: S.range.x1 + 20, y: 0, angle: 0, r: 8 + Math.random() * 5 });
    }
    for (let i = S.tumbleweeds.length - 1; i >= 0; i--) {
      const w = S.tumbleweeds[i];
      const vx = S.drift.px * 1.25 + rnd(ATMO.tumbleSpeedExtra);
      w.x -= vx * dt;
      w.angle -= vx * dt / Math.max(4, w.r);
      const y = yAt(w.x);
      if (y !== null) w.y = y - w.r * 0.6;
      if (w.x < S.range.x0 - 60) S.tumbleweeds.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   *  Косметика: раз на раунд шанс на аксесуар
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

    // таймер стрибнув угору — новий раунд
    if (left !== null && S.round.prev !== null && left > S.round.prev + 5) {
      beginFall(R);
    }
    if (left !== null) S.round.prev = left;

    if (!R.alive) beginFall(R);

    // страховка: не встиг добігти, а раунд кінчається — пірнаємо звідки є
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

        // приземлення там, де дуга реально перетинає лінію (а не на висоті
        // відштовхування — інакше на сходинку не залізти); jumpV > 0 виключає
        // хибне приземлення на кадрі з dt = 0
        const gLand = yAt(R.x);
        const yNow = R.groundY + R.jumpOff;
        const landed = gLand !== null ? yNow >= gLand : R.jumpOff >= 0;
        if (R.jumpV > 0 && landed) {
          if (gLand !== null) R.groundY = gLand;
          R.jumpOff = 0;
          R.vFall = 0;
          spawnDust(R.x - 3, R.y, 1);
          R.state = R.resume; // повертаємось туди, звідки стрибнули
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
          // швидкість підбираємо так, щоб долетіти до вістря саме під кінець
          const timeLeft = Math.max(0.8, (left ?? B.sprintAt) - B.diveLead);
          R.speed = clamp((S.range.x1 - R.x) / timeLeft, 60, B.sprintMax);
        } else {
          R.speed = R.baseSpeed * cfg.speed;
        }
        // на ривку схил не гальмує — інакше не встигав добігти за 10с
        const eff = R.sprint
          ? R.speed
          : R.speed * clamp(1 + S.slope * 0.45, 0.55, 1.5);
        R.x += eff * dt;
        R.cycleGain += eff * dt;

        // виходимо одразу, якщо змінили стан — інакше перевірка цілі нижче
        // переведе у відпочинок просто в повітрі
        if (tryHurdle(R)) break;

        // стрибаємо тільки перестрибну стінку; надто високу видряпуємось,
        // інакше застрягнемо в нескінченному стрибанні перед нею
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

        // добіг майже до вістря, а раунд ще не закінчується — дме вітер
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
      // земля береться не миттєво, а згладжено: падаємо/видряпуємось, замість
      // перескоку на нову висоту при різкому русі ціни. У стрибку рівень
      // заморожений на точці відштовхування.
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
   *  Головний цикл
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
        if (cfg.debug) console.log(TAG, 'колір лінії', S.line);
      } else if (S.status !== 'error') {
        S.status = 'searching';
        S.reason = 'лінію ще не видно на графіку';
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
      // голова дивиться рівно за вектором швидкості: θ = atan2(vx, -vy)
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
      R.phase += 24 * dt; // біжить на місці, а вітер зносить назад
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
      });
    }
    if (R.state === 'gone') return;
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
   *  Стеження за DOM / SPA-навігацією
   * ------------------------------------------------------------------ */

  // Сторінка постійно смикає DOM (тікери цін), тому MutationObserver з
  // debounce ніколи б не спрацював — перевіряємо за таймером.
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
   *  Налаштування
   * ------------------------------------------------------------------ */

  // для налагодження з консолі; у розширенні DevTools — окремий контекст,
  // треба перемкнути випадайку зверху консолі на «XO Pulse Runner»
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
