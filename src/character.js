/*
 * XO Chicken: a vector character. Local coordinates — feet at (0,0),
 * facing right, height ≈ 50 units. Mirroring is done via dir = -1.
 */
window.XOChicken = (() => {
  'use strict';

  const C = {
    body: '#9a90ec',
    bodyDark: '#8479e4',
    head: '#c8e84a',
    comb: '#f2718f',
    wattle: '#f78fa7',
    beak: '#ff9a1f',
    legs: '#ff9a1f',
    legsDark: '#dd7c0b',
    badge: '#f7a8c0',
    chain: '#e8a13c',
    line: '#1c1c1c',
    white: '#ffffff',
    sweat: '#7cc4f2',
    post: '#9aa0aa',
    bar: '#f2718f',
    star: '#ffd23f',
  };

  // A little color variety per hurdle so a row of them doesn't read as
  // the same cutout repeated — picked by a stable per-hurdle tint (0..1).
  const HURDLE_PALETTE = [
    { post: '#9aa0aa', bar: '#f2718f', flag: '#e2536f' },
    { post: '#a3968a', bar: '#f7a94f', flag: '#dc7e1d' },
    { post: '#93a4ab', bar: '#7ecbe8', flag: '#4a9fc4' },
    { post: '#a6a08f', bar: '#9fd67e', flag: '#5fa63e' },
  ];

  const LW = 0.66; // outline thickness, ~1.3% of height

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* -------------------------------------------------------------- *
   *  Primitives
   * -------------------------------------------------------------- */

  function outlined(ctx, path, fill, lw) {
    ctx.lineWidth = lw || LW;
    ctx.strokeStyle = C.line;
    ctx.fillStyle = fill;
    ctx.beginPath();
    path(ctx);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /** A limb: a thick stroke with a black outline. */
  function limb(ctx, pts, w, fill) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = w + LW * 2;
    ctx.stroke();
    ctx.strokeStyle = fill;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  /* -------------------------------------------------------------- *
   *  Poses
   * -------------------------------------------------------------- */

  const HIP = { x: 0, y: -12.5 };
  const SHO = { x: -0.5, y: -26 };

  /** p — step-cycle phase, br — breathing phase. */
  function pose(state, p, br) {
    if (state === 'jump') {
      return {
        lean: 0.12,
        bob: 0,
        feet: [
          { x: -3.6, y: -6 },
          { x: 2.6, y: -7 },
        ],
        wing: { ang: -0.45, len: 13, w: 5 },
        puff: 0,
        head: { rot: -0.12 },
      };
    }

    if (state === 'hurt') {
      const br2 = Math.sin(br * 0.5) * 0.5;
      return {
        lean: 0,
        bob: 0,
        pivot: 14,
        feet: [
          { x: -5.5, y: -2.5 },
          { x: -3.5, y: -5.5 },
        ],
        wing: { ang: -0.6, len: 12, w: 4.6 },
        puff: 0.4 + br2,
        head: { rot: 0.35 },
        dazed: true,
      };
    }

    if (state === 'rise') {
      const k = Math.max(0, Math.sin(p * 1.6));
      return {
        lean: 0.1,
        bob: 0,
        feet: [
          { x: -3.4, y: -1 + k * 1 },
          { x: 2.2 + k * 1.4, y: 0 },
        ],
        wing: { ang: 1.2 - k * 0.7, len: 11, w: 4.4 },
        puff: 0.2,
        head: { rot: -0.2 * k },
      };
    }

    if (state === 'trip') {
      return {
        lean: 0,
        bob: 0,
        feet: [
          { x: -5.4, y: -4.5 + Math.sin(p * 7) * 2.4 },
          { x: 4.8, y: -3.5 - Math.sin(p * 7) * 2.4 },
        ],
        wing: { ang: -1.5 + Math.sin(p * 9) * 0.6, len: 12, w: 4.6 },
        puff: 0.3,
        head: { rot: 0.25 },
      };
    }

    if (state === 'peck') {
      const k = Math.max(0, Math.sin(p));
      return {
        lean: 0.06 + k * 0.14,
        bob: 0,
        feet: [
          { x: -2.6, y: 0 },
          { x: 3.2, y: 0 },
        ],
        wing: { ang: 2.2, len: 10, w: 4.2 },
        puff: 0,
        head: { rot: k * 1.15, dy: k * 3.4, dx: k * 1.4 },
      };
    }

    if (state === 'flap') {
      const f = Math.sin(p * 2);
      return {
        lean: 0,
        bob: -Math.max(0, f) * 2.4,
        feet: [
          { x: -2.8, y: 0 },
          { x: 3.2, y: 0 },
        ],
        wing: { ang: 0.4 - f * 1.9, len: 13, w: 5 },
        puff: 0.25,
        head: { rot: -0.08 },
      };
    }

    if (state === 'look') {
      const k = Math.sin(p * 0.7);
      return {
        lean: -0.04,
        bob: 0,
        feet: [
          { x: -2.6, y: 0 },
          { x: 3.2, y: 0 },
        ],
        wing: { ang: 1.9, len: 10, w: 4.2 },
        puff: 0,
        head: { rot: -0.5 + k * 0.16 },
      };
    }

    if (state === 'scratch') {
      const k = Math.sin(p * 3);
      return {
        lean: 0.03,
        bob: 0,
        feet: [
          { x: -2.4, y: 0 },
          { x: 1.6, y: -7.5 + k * 1.2 },
        ],
        wing: { ang: 2.1, len: 10, w: 4.2 },
        puff: 0,
        head: { rot: 0.12 + k * 0.06 },
      };
    }

    if (state === 'wind') {
      // the wind carries it backward while it's still pumping its legs
      // forward — body leaned back against the wind, wing and tail streaming
      const stride = 5.6;
      const lift = 3.4;
      const foot = (ph) => ({
        x: Math.cos(ph) * stride,
        y: -Math.max(0, -Math.sin(ph)) * lift,
      });
      const sw = Math.sin(p);
      return {
        lean: -0.42,
        bob: -Math.abs(Math.sin(p)) * 1.1,
        feet: [foot(p + Math.PI), foot(p)],
        wing: { ang: 2.05 + sw * 0.5, len: 13.5, w: 4.6 },
        puff: 0.1,
        head: { rot: -0.1 },
      };
    }

    if (state === 'dive') {
      // pivot: the body rotates around its own middle, not around the
      // feet — otherwise turning head-down would send it sliding sideways
      return {
        lean: 0,
        bob: 0,
        pivot: 25,
        feet: [
          { x: -1.2, y: 3.6 },
          { x: 1.4, y: 4.6 },
        ],
        // two narrower wings flank the head so it still reads between them
        wing: { ang: -1.62, len: 19, w: 3.1, bx: 6, by: -26 },
        wing2: { ang: -1.48, len: 20, w: 3, bx: 0.5, by: -26 },
        wingOnTop: true, // the near wing is drawn on top of the head
        puff: 0,
        head: { rot: 0 },
      };
    }

    if (state === 'fall') {
      const f = Math.sin(p);
      return {
        lean: -0.14,
        bob: 0,
        feet: [
          { x: -5.2, y: -2.6 + f * 1.6 },
          { x: 5, y: -2.2 - f * 1.6 },
        ],
        wing: { ang: -1.35 + f * 0.45, len: 13.5, w: 4.8 },
        puff: 0.5,
      };
    }

    if (state === 'rest') {
      const puff = Math.sin(br) * 0.6;
      return {
        lean: 0.02,
        bob: puff * 0.5,
        feet: [
          { x: -2.6, y: 0 },
          { x: 3.2, y: 0 },
        ],
        wing: { ang: 1.78 + puff * 0.06, len: 10.5, w: 4.4 },
        puff,
      };
    }

    const run = state === 'run';
    const stride = run ? 6.4 : 3.6;
    const lift = run ? 4.6 : 1.7;
    // the planted foot moves forward→back, the swinging one back→forward;
    // swap the directions and the character walks backward
    const foot = (ph) => ({
      x: Math.cos(ph) * stride,
      y: -Math.max(0, -Math.sin(ph)) * lift,
    });

    const sw = Math.sin(p);
    const wing = run
      ? { ang: 3.45 + sw * 0.4, len: 13, w: 4.4 }
      : { ang: 2.5 + sw * 0.14, len: 11, w: 4.2 };

    return {
      lean: run ? 0.16 : 0.05,
      bob: -Math.abs(Math.sin(p)) * (run ? 1.6 : 0.7),
      feet: [foot(p + Math.PI), foot(p)],
      wing,
      puff: 0,
    };
  }

  /* -------------------------------------------------------------- *
   *  Body parts
   * -------------------------------------------------------------- */

  function feather(ctx, bx, by, a, len, w, fill) {
    const tx = bx + Math.cos(a) * len;
    const ty = by + Math.sin(a) * len;
    const nx = -Math.sin(a);
    const ny = Math.cos(a);
    outlined(
      ctx,
      (c) => {
        c.moveTo(bx + nx * w * 0.6, by + ny * w * 0.6);
        c.quadraticCurveTo(
          bx + (tx - bx) * 0.45 + nx * w,
          by + (ty - by) * 0.45 + ny * w,
          tx,
          ty
        );
        c.quadraticCurveTo(
          bx + (tx - bx) * 0.5 - nx * w * 0.9,
          by + (ty - by) * 0.5 - ny * w * 0.9,
          bx - nx * w * 1.1,
          by - ny * w * 1.1
        );
      },
      fill
    );
  }

  function tail(ctx, lift) {
    const specs = [
      [3.06, 17, 3.5],
      [2.81, 15.5, 3.3],
      [2.55, 13, 3.0],
    ];
    for (const [a0, len, w] of specs) {
      feather(ctx, -7, -22, a0 - lift * 0.1, len, w, C.body);
    }
  }

  function leg(ctx, foot, col) {
    const ankle = { x: foot.x * 0.85, y: foot.y - 3.4 };
    const knee = {
      x: HIP.x + (ankle.x - HIP.x) * 0.5 + 1.2,
      y: HIP.y + (ankle.y - HIP.y) * 0.55,
    };
    limb(ctx, [HIP, knee, ankle], 1.7, col);
    const f = { x: foot.x, y: foot.y };
    limb(ctx, [ankle, f], 1.7, col);
    limb(ctx, [f, { x: f.x + 3.4, y: f.y + 0.2 }], 1.3, col);
    limb(ctx, [f, { x: f.x + 2.8, y: f.y - 1.4 }], 1.2, col);
    limb(ctx, [f, { x: f.x - 2.2, y: f.y + 0.1 }], 1.2, col);
  }

  function body(ctx, puff) {
    outlined(ctx, (c) => {
      c.ellipse(0, -21, 9.2 + puff * 0.35, 10.5 + puff * 0.25, 0, 0, Math.PI * 2);
    }, C.body);
  }

  function badge(ctx) {
    ctx.strokeStyle = C.chain;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-2.4, -28.9);
    ctx.quadraticCurveTo(2.4, -24.4, 6.4, -28.4);
    ctx.stroke();
    outlined(
      ctx,
      (c) => {
        const x = 1.4;
        const y = -25.2;
        const w = 4.2;
        const h = 6.2;
        const r = 1;
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
      },
      C.badge
    );
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(2.6, -23.9);
    ctx.lineTo(4.0, -22.5);
    ctx.moveTo(4.0, -23.9);
    ctx.lineTo(2.6, -22.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(3.3, -20.7, 0.95, 0, Math.PI * 2);
    ctx.stroke();
  }

  function head(ctx, tired, beakOpen, blink, dazed) {
    const cy = -36.5;

    // comb — a closed 'wave' made of three points
    outlined(ctx, (c) => {
      c.moveTo(-3.8, cy - 5.6);
      c.quadraticCurveTo(-5.4, cy - 12.6, -2.2, cy - 11.4);
      c.quadraticCurveTo(-1.7, cy - 15.2, 0.6, cy - 12.4);
      c.quadraticCurveTo(2.0, cy - 16.0, 3.2, cy - 11.6);
      c.quadraticCurveTo(4.8, cy - 13.0, 4.4, cy - 6.2);
      c.quadraticCurveTo(0.4, cy - 8.4, -3.8, cy - 5.6);
    }, C.comb);

    // head with a feathered 'skirt' along the bottom
    outlined(ctx, (c) => {
      c.moveTo(-6.8, cy + 2);
      c.quadraticCurveTo(-6.9, cy - 7.2, 0, cy - 7.4);
      c.quadraticCurveTo(6.8, cy - 7.2, 6.8, cy + 2);
      const pts = [5.2, 3.4, 1.5, -0.5, -2.6, -4.8];
      let up = false;
      for (const x of pts) {
        c.lineTo(x, cy + (up ? 4.4 : 8.6));
        up = !up;
      }
    }, C.head);

    // beak
    const open = beakOpen * 1.7;
    outlined(ctx, (c) => {
      c.moveTo(4.8, cy - 1.0 - open * 0.3);
      c.lineTo(10.6, cy + 0.5 - open * 0.5);
      c.lineTo(5.0, cy + 1.4 - open * 0.2);
    }, C.beak);
    outlined(ctx, (c) => {
      c.moveTo(5.0, cy + 1.4 + open * 0.4);
      c.lineTo(9.9, cy + 1.9 + open * 0.9);
      c.lineTo(5.0, cy + 2.9 + open * 0.5);
    }, C.beak);

    // wattle
    outlined(ctx, (c) => {
      c.moveTo(4.9, cy + 2.6 + open * 0.5);
      c.quadraticCurveTo(3.9, cy + 6.6 + open, 5.5, cy + 6.8 + open);
      c.quadraticCurveTo(6.6, cy + 5.0 + open, 6.2, cy + 2.4 + open * 0.5);
    }, C.wattle);

    // eyes
    const eyes = [
      { x: 0.2, y: cy - 1.4, r: 2.6 },
      { x: 4.2, y: cy - 1.6, r: 2.3 },
    ];
    for (const e of eyes) {
      if (dazed) {
        ctx.strokeStyle = C.line;
        ctx.lineWidth = LW;
        ctx.beginPath();
        ctx.moveTo(e.x - e.r * 0.6, e.y - e.r * 0.6);
        ctx.lineTo(e.x + e.r * 0.6, e.y + e.r * 0.6);
        ctx.moveTo(e.x + e.r * 0.6, e.y - e.r * 0.6);
        ctx.lineTo(e.x - e.r * 0.6, e.y + e.r * 0.6);
        ctx.stroke();
        continue;
      }
      if (blink) {
        ctx.strokeStyle = C.line;
        ctx.lineWidth = LW;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        continue;
      }
      outlined(ctx, (c) => c.arc(e.x, e.y, e.r, 0, Math.PI * 2), C.white, 0.55);
      ctx.fillStyle = C.line;
      ctx.beginPath();
      ctx.arc(e.x + 0.5, e.y + (tired ? 0.5 : 0.2), e.r * 0.42, 0, Math.PI * 2);
      ctx.fill();
      if (tired) {
        ctx.fillStyle = C.head;
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        ctx.moveTo(e.x - e.r - 0.2, e.y - e.r * 0.15);
        ctx.lineTo(e.x + e.r + 0.2, e.y - e.r * 0.15);
        ctx.lineTo(e.x + e.r + 0.2, e.y - e.r - 0.6);
        ctx.lineTo(e.x - e.r - 0.2, e.y - e.r - 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(e.x - e.r - 0.2, e.y - e.r * 0.15);
        ctx.lineTo(e.x + e.r + 0.2, e.y - e.r * 0.15);
        ctx.stroke();
      }
    }
  }

  /* -------------------------------------------------------------- *
   *  Public drawing entry point
   * -------------------------------------------------------------- */

  /** o: {x, y, dir, state, phase, t, scale, angle}; angle — ground tilt. */
  function draw(ctx, o) {
    const s = (o.scale || 1) * 0.78;
    const dir = o.dir >= 0 ? 1 : -1;
    const state = o.state || 'run';
    const t = o.t || 0;
    const ground = o.angle || 0;
    const br = t * (state === 'rest' ? 6.5 : 3);
    const P = pose(state, o.phase || 0, br);

    // legs only partly follow the slope (K); mid-jump/trip the torso is
    // one rigid piece with the legs, no separate lean needed
    const rigid =
      state === 'dive' || state === 'trip' || state === 'hurt' || state === 'rise';
    const legTilt = rigid ? ground : ground * 0.55;
    const K = rigid ? 0 : state === 'run' ? 1.15 : state === 'walk' ? 0.9 : 1;
    const torso = clamp(P.lean - legTilt * dir * K, -0.55, 0.55);

    ctx.save();
    ctx.translate(o.x, o.y);
    const piv = (P.pivot || 0) * s;
    if (piv) {
      ctx.translate(0, -piv);
      ctx.rotate(legTilt);
      ctx.translate(0, piv);
    } else {
      ctx.rotate(legTilt);
    }
    ctx.scale(dir * s, s);
    ctx.translate(0, P.bob);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.miterLimit = 2;

    const upper = (fn) => {
      ctx.save();
      ctx.translate(HIP.x, HIP.y);
      ctx.rotate(torso);
      ctx.translate(-HIP.x, -HIP.y);
      fn();
      ctx.restore();
    };

    upper(() => tail(ctx, state === 'run' || state === 'wind' ? 1 : 0));
    leg(ctx, P.feet[0], C.legsDark);
    const drawWing = (w, fill) =>
      feather(ctx, w.bx ?? 3, w.by ?? -25, w.ang, w.len, w.w, fill);

    upper(() => {
      body(ctx, P.puff);
      if (P.wing2) drawWing(P.wing2, C.bodyDark);
      if (!P.wingOnTop) drawWing(P.wing, C.bodyDark);
      badge(ctx);
    });
    leg(ctx, P.feet[1], C.legs);

    const tired = state === 'rest';
    const beakOpen = tired ? Math.sin(br) * 0.5 + 0.5 : state === 'peck' ? 0.5 : 0;
    const blink = ((t * 1000) % 4200) < 130;
    const H = P.head || {};
    upper(() => {
      ctx.save();
      ctx.translate(H.dx || 0, H.dy || 0);
      if (H.rot) {
        ctx.translate(0, -30.5);
        ctx.rotate(H.rot);
        ctx.translate(0, 30.5);
      }
      head(ctx, tired, beakOpen, blink && !tired, P.dazed);
      if (o.cosmetic) drawCosmetic(ctx, o.cosmetic);
      ctx.restore();
    });

    if (P.wingOnTop) upper(() => drawWing(P.wing, C.body));

    if (tired) {
      const n = 2;
      for (let i = 0; i < n; i++) {
        const k = ((t * 0.9 + i * 0.5) % 1);
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = C.sweat;
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 0.45;
        ctx.beginPath();
        ctx.ellipse(
          -8 - k * 7 - i * 1.5,
          -40 + k * 9 + i * 2,
          1.1,
          1.5,
          -0.5,
          0,
          Math.PI * 2
        );
        ctx.fill();
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // drawn outside the character's transform so the stars don't spin along with the body
    if (P.dazed) {
      ctx.save();
      ctx.translate(o.x, o.y - 30 * s);
      for (let i = 0; i < 3; i++) {
        const a = t * 3.4 + (i * Math.PI * 2) / 3;
        const sx = Math.cos(a) * 11 * s;
        const sy = Math.sin(a) * 3.6 * s;
        star(ctx, sx, sy, 2.6 * s);
      }
      ctx.restore();
    }
  }

  function star(ctx, x, y, r) {
    ctx.fillStyle = C.star;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = r * 0.22;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 ? r * 0.38 : r;
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /* -------------------------------------------------------------- *
   *  Cosmetics: a per-round chance at sunglasses or a flower
   * -------------------------------------------------------------- */

  function drawCosmetic(ctx, kind) {
    const cy = -36.5;
    if (kind === 'shades') {
      // lenses are a bit bigger than the eyes themselves (r 2.6/2.3), but
      // don't merge together — otherwise two lenses become one black blob.
      // A mid-tone rim (not the same near-black as the fill) plus a glass
      // highlight are what actually read as "glasses" instead of just
      // solid dark eyes — without them it's indistinguishable from a blink.
      const lensL = { x: 0.2, y: cy - 1.4 };
      const lensR = { x: 4.2, y: cy - 1.6 };
      ctx.fillStyle = '#23262c';
      ctx.strokeStyle = '#5b5f6a';
      ctx.lineWidth = LW;
      for (const e of [lensL, lensR]) {
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, 1.8, 1.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = '#5b5f6a';
      ctx.beginPath();
      ctx.moveTo(lensL.x + 1.8, lensL.y);
      ctx.lineTo(lensR.x - 1.8, lensR.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lensR.x + 1.8, lensR.y);
      ctx.lineTo(lensR.x + 4, lensR.y - 1.4);
      ctx.stroke();
      // glass highlight — a short bright streak on each lens
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = LW * 0.9;
      ctx.lineCap = 'round';
      for (const e of [lensL, lensR]) {
        ctx.beginPath();
        ctx.moveTo(e.x - 0.9, e.y - 0.75);
        ctx.lineTo(e.x - 0.1, e.y - 1.1);
        ctx.stroke();
      }
      return;
    }
    if (kind === 'flower') {
      const fx = -4.6;
      const fy = cy - 9;
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5;
        outlined(
          ctx,
          (c) => {
            c.ellipse(fx + Math.cos(a) * 1.5, fy + Math.sin(a) * 1.5, 1.3, 0.85, a, 0, Math.PI * 2);
          },
          '#ffdcec',
          0.4
        );
      }
      ctx.fillStyle = C.star;
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.arc(fx, fy, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /* -------------------------------------------------------------- *
   *  Small line events
   * -------------------------------------------------------------- */

  /** Puddle: a flat spot on the line; the character splashes through it. */
  function drawPuddle(ctx, o) {
    const w = (o.w || 30) / 2;
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#bcdcf2';
    ctx.strokeStyle = '#8fb9d6';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(o.x, o.y + 2, w, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // a thin bright streak — a lazy hint of sky reflection, not a literal one
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#eef7ff';
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(o.x - w * 0.45, o.y + 1.2);
    ctx.lineTo(o.x + w * 0.1, o.y + 1.2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // A stable pseudo-random keyed by index — the tumbleweed's twigs are the
  // same every frame (no flicker), but chaotic rather than symmetric.
  function hash01(n) {
    const s = Math.sin(n * 12.9898) * 43758.5453;
    return s - Math.floor(s);
  }

  /** Tumbleweed: a tangle of twigs, hops and rolls along the line on its own. */
  function drawTumbleweed(ctx, o) {
    const r = o.r || 10;
    const seed = o.seed || 0;
    const groundY = o.groundY ?? o.y;
    const hop = groundY - o.y;

    // contact shadow at ground level — shrinks while airborne mid-hop
    const shrink = clamp(1 - hop / (r * 2), 0.25, 1);
    ctx.save();
    ctx.globalAlpha = 0.18 * shrink;
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.ellipse(o.x, groundY + r * 0.5, r * 0.85 * shrink, r * 0.24 * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle || 0);
    ctx.fillStyle = 'rgba(156,138,94,0.18)';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // Twigs are short segments between random points inside the circle,
    // NOT straight lines through the center — otherwise instead of a
    // tangle you get even spokes, and it reads as a wheat ear or a wheel
    // rather than a bush. Offsetting the hash by a per-instance seed keeps
    // each tumbleweed's tangle distinct instead of every one being an
    // identical clone.
    ctx.strokeStyle = '#8a7550';
    ctx.lineWidth = 0.9;
    ctx.lineCap = 'round';
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a1 = hash01(seed + i * 2 + 1) * Math.PI * 2;
      const a2 = hash01(seed + i * 2 + 2) * Math.PI * 2;
      const r1 = r * (0.15 + hash01(seed + i * 3 + 1) * 0.55);
      const r2 = r * (0.55 + hash01(seed + i * 3 + 2) * 0.45);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a1) * r1, Math.sin(a1) * r1);
      ctx.lineTo(Math.cos(a2) * r2, Math.sin(a2) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A little scatter of ground pebbles — pure texture, no interaction. */
  function drawPebbles(ctx, o) {
    const seed = o.seed || 0;
    const n = 2 + Math.floor(hash01(seed) * 2);
    for (let i = 0; i < n; i++) {
      const dx = (hash01(seed + i * 5 + 1) - 0.5) * 14;
      const rr = 0.9 + hash01(seed + i * 5 + 2) * 1.1;
      outlined(
        ctx,
        (c) => c.ellipse(o.x + dx, o.y + 1.5, rr, rr * 0.62, 0, 0, Math.PI * 2),
        '#b9b2a4',
        0.4
      );
    }
  }

  /* -------------------------------------------------------------- *
   *  Grounding shadow — shared by the runner and the hurdles so both
   *  read as sitting on the line instead of floating over it.
   * -------------------------------------------------------------- */

  /** height — how far above the ground (units), 0 when grounded. */
  function drawShadow(ctx, x, groundY, height, scale) {
    const s = (scale || 1) * 0.78;
    const shrink = clamp(1 - Math.max(0, height) / 50, 0.3, 1);
    ctx.save();
    ctx.globalAlpha = 0.24 * shrink;
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.ellipse(x, groundY + 1.6 * s, 7.5 * s * shrink, 2 * s * shrink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* -------------------------------------------------------------- *
   *  Hurdle
   * -------------------------------------------------------------- */

  /** knock: 0..1 — how far the hurdle has toppled. */
  function drawHurdle(ctx, o) {
    const s = (o.scale || 1) * 0.78;
    const alpha = o.alpha ?? 1;
    const pal = HURDLE_PALETTE[Math.floor((o.tint || 0) * HURDLE_PALETTE.length) % HURDLE_PALETTE.length];

    drawShadow(ctx, o.x, o.y, 0, o.scale);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle || 0);
    ctx.scale(s, s);
    if (o.knock) {
      // rotate around the bottom edge and lift by half the thickness, so a
      // knocked-over hurdle lies on the line instead of sinking under it
      const k = o.knock;
      ctx.rotate(k * 1.5);
      ctx.translate(0, -k * 6.6);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (o.kind === 'cone') {
      outlined(ctx, (c) => c.ellipse(0, 0, 7, 1.8, 0, 0, Math.PI * 2), pal.post, 0.4);
      outlined(
        ctx,
        (c) => {
          c.moveTo(-6.4, 0);
          c.lineTo(-2.6, -19.6);
          c.lineTo(2.6, -19.6);
          c.lineTo(6.4, 0);
        },
        pal.bar
      );
      // two accent stripes — an unbroken cone silhouette reads flat otherwise
      outlined(
        ctx,
        (c) => {
          c.moveTo(-3.6, -13.2);
          c.lineTo(3.6, -13.2);
          c.lineTo(3.1, -16.2);
          c.lineTo(-3.1, -16.2);
        },
        pal.flag,
        0.4
      );
      outlined(
        ctx,
        (c) => {
          c.moveTo(-4.9, -6);
          c.lineTo(4.9, -6);
          c.lineTo(4.2, -9.4);
          c.lineTo(-4.2, -9.4);
        },
        pal.flag,
        0.4
      );
    } else {
      limb(ctx, [{ x: -6.2, y: 0 }, { x: -3.4, y: -18 }], 1.9, pal.post);
      limb(ctx, [{ x: 6.2, y: 0 }, { x: 3.4, y: -18 }], 1.9, pal.post);
      outlined(
        ctx,
        (c) => {
          c.moveTo(-7.4, -19.6);
          c.lineTo(7.4, -19.6);
          c.lineTo(7.4, -15.4);
          c.lineTo(-7.4, -15.4);
        },
        pal.bar
      );
      // a small pennant on the near post — otherwise a plain bar reads flat
      outlined(
        ctx,
        (c) => {
          c.moveTo(-7.4, -19.6);
          c.lineTo(-7.4, -25.6);
          c.lineTo(-3.2, -22);
        },
        pal.flag,
        0.5
      );
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return { draw, drawHurdle, drawPuddle, drawTumbleweed, drawPebbles, drawShadow, colors: C };
})();
