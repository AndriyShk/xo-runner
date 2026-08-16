/*
 * XO-півень: векторний персонаж. Локальні координати — лапи в (0,0),
 * дивиться праворуч, зріст ≈ 50 одиниць. Дзеркалення — через dir = -1.
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

  const LW = 0.66; // товщина контуру, ~1.3% зросту

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* -------------------------------------------------------------- *
   *  Примітиви
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

  /** Кінцівка: товстий штрих із чорною обводкою. */
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
   *  Пози
   * -------------------------------------------------------------- */

  const HIP = { x: 0, y: -12.5 };
  const SHO = { x: -0.5, y: -26 };

  /** p — фаза циклу кроку, br — фаза дихання. */
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

    if (state === 'dive') {
      // pivot: тіло крутиться навколо своєї середини, а не навколо лап —
      // інакше при розвороті головою вниз його зносить убік
      return {
        lean: 0,
        bob: 0,
        pivot: 25,
        feet: [
          { x: -1.2, y: 3.6 },
          { x: 1.4, y: 4.6 },
        ],
        // два вужчі крила обабіч голови, щоб вона читалась між ними
        wing: { ang: -1.62, len: 19, w: 3.1, bx: 6, by: -26 },
        wing2: { ang: -1.48, len: 20, w: 3, bx: 0.5, by: -26 },
        wingOnTop: true, // ближнє крило йде поверх голови
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
    // опорна лапа йде вперед→назад, махова — назад→вперед; переплутати
    // напрями = персонаж крокує задом наперед
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
   *  Частини тіла
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

    // гребінь — замкнута «хвиля» з трьох язиків
    outlined(ctx, (c) => {
      c.moveTo(-3.8, cy - 5.6);
      c.quadraticCurveTo(-5.4, cy - 12.6, -2.2, cy - 11.4);
      c.quadraticCurveTo(-1.7, cy - 15.2, 0.6, cy - 12.4);
      c.quadraticCurveTo(2.0, cy - 16.0, 3.2, cy - 11.6);
      c.quadraticCurveTo(4.8, cy - 13.0, 4.4, cy - 6.2);
      c.quadraticCurveTo(0.4, cy - 8.4, -3.8, cy - 5.6);
    }, C.comb);

    // голова з «спідницею» з пір'я знизу
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

    // дзьоб
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

    // борідка
    outlined(ctx, (c) => {
      c.moveTo(4.9, cy + 2.6 + open * 0.5);
      c.quadraticCurveTo(3.9, cy + 6.6 + open, 5.5, cy + 6.8 + open);
      c.quadraticCurveTo(6.6, cy + 5.0 + open, 6.2, cy + 2.4 + open * 0.5);
    }, C.wattle);

    // очі
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
   *  Публічний малювальник
   * -------------------------------------------------------------- */

  /** o: {x, y, dir, state, phase, t, scale, angle}; angle — нахил землі. */
  function draw(ctx, o) {
    const s = (o.scale || 1) * 0.78;
    const dir = o.dir >= 0 ? 1 : -1;
    const state = o.state || 'run';
    const t = o.t || 0;
    const ground = o.angle || 0;
    const br = t * (state === 'rest' ? 6.5 : 3);
    const P = pose(state, o.phase || 0, br);

    // лапи підлаштовуються під схил частково (K); у польоті/трипі тулуб — одна
    // суцільна лінія з лапами, окремий нахил не потрібен
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

    upper(() => tail(ctx, state === 'run' ? 1 : 0));
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

    // малюємо поза transform персонажа, щоб зірочки не крутились разом із тілом
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
   *  Перешкода
   * -------------------------------------------------------------- */

  /** knock: 0..1 — наскільки бар'єр завалений. */
  function drawHurdle(ctx, o) {
    const s = (o.scale || 1) * 0.78;
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle || 0);
    ctx.scale(s, s);
    if (o.knock) {
      // обертаємо навколо нижнього краю й підіймаємо на пів товщини,
      // щоб збитий бар'єр ліг на лінію, а не пішов під неї
      const k = o.knock;
      ctx.rotate(k * 1.5);
      ctx.translate(0, -k * 6.6);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    limb(ctx, [{ x: -6.2, y: 0 }, { x: -3.4, y: -18 }], 1.9, C.post);
    limb(ctx, [{ x: 6.2, y: 0 }, { x: 3.4, y: -18 }], 1.9, C.post);
    outlined(
      ctx,
      (c) => {
        c.moveTo(-7.4, -19.6);
        c.lineTo(7.4, -19.6);
        c.lineTo(7.4, -15.4);
        c.lineTo(-7.4, -15.4);
      },
      C.bar
    );
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  return { draw, drawHurdle, colors: C };
})();
