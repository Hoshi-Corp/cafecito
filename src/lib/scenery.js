/* eslint-disable */
// Scenery painted on canvases: a seasonal landscape (mountains, a tree line, hills and a meadow) and trees of real
// species. Aspens come from our own renderer; larches and maples from the one GPT 6.1 Sol drew (each did its species
// best).

// How sharp to paint. Apple devices (our users are on recent Macs and iPhone 14 or newer; iPads say "Macintosh")
// and machines with 8 or more cores paint at the screen's full sharpness, up to 3x; everything else at up to 2x,
// which looks nearly the same and is much less work.
const paintRatio = () => {
  const crisp = /iPhone|iPad|Macintosh/.test(navigator.userAgent) || (navigator.hardwareConcurrency || 0) >= 8;
  return Math.min(crisp ? 3 : 2, globalThis.devicePixelRatio || 1);
};

export const drawLandscape = (function () {
// A layered landscape on a canvas: far mountains, a tree line, rolling hills and a meadow with grass, flowers,
// rocks and bushes. It follows the season and the time of day. drawLandscape(canvas, { season, phase, seed, ground })
// fills the canvas; `ground` is the y (in CSS px) where people and trees stand, and the meadow is level there.

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mixRGB = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const PHASE = { day: null, dawn: [[255, 205, 175], .12], dusk: [[120, 60, 85], .25], night: [[10, 22, 44], .62] };

// Colours per season: far mountains, near mountains, tree line, far hill, near hill, meadow (far, near),
// shadow and sunlit patches, grass blades, bushes (shade, base, light).
const LAND = {
  spring: { far: "#9cb6c6", near: "#7fa596", trees: "#3f7a5c", hillFar: "#b8dc78", hillNear: "#a3d164", meadow: ["#b5dd6a", "#8cc653"], shadow: "#79b044", sun: "#d2ec8e", blades: ["#6fa53c", "#9ad05a", "#5d9332"], bush: ["#3f7a34", "#5b9a41", "#86c25c"] },
  summer: { far: "#94adbf", near: "#6f9887", trees: "#2f6a4c", hillFar: "#a8d466", hillNear: "#8fc455", meadow: ["#9fd05a", "#78b844"], shadow: "#64a03a", sun: "#c4e67e", blades: ["#5b9632", "#86c24c", "#4c8329"], bush: ["#2f6a2a", "#47883a", "#72b052"] },
  fall: { far: "#a7aebb", near: "#8f9a82", trees: "#6f6a3a", hillFar: "#d2c36a", hillNear: "#c4b257", meadow: ["#cbbd5e", "#b2a144"], shadow: "#9c8b36", sun: "#e2d585", blades: ["#9a8a32", "#c9b45a", "#8a6f2a"], bush: ["#a0461c", "#d06a26", "#eea04a"] },
  winter: { far: "#b9c7d6", near: "#9fb3c4", trees: "#3d5a57", hillFar: "#eef3f8", hillNear: "#e6edf5", meadow: ["#f1f5fa", "#e2eaf3"], shadow: "#c9d6e6", sun: "#ffffff", blades: ["#b9a77a", "#a8946a", "#cbbd94"], bush: ["#5d6f6a", "#788a84", "#e9eef4"] },
};

function drawLandscape(canvas, opts = {}) {
  const { season = "summer", phase = "day", seed = 5 } = opts;
  const dpr = paintRatio(), W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const rand = rng(seed), R = (a, b) => a + rand() * (b - a);
  const L = LAND[season], wide = W > 640;
  const lit = (c, extra = 0) => { const rgb = typeof c === "string" ? hex(c) : c; return PHASE[phase] ? mixRGB(rgb, PHASE[phase][0], Math.min(1, PHASE[phase][1] + extra)) : rgb; };
  const G = opts.ground ?? H - 88;
  // Keep the far scenery low where the headline sits (the left on wide screens, the top on phones).
  const calm = (x) => (wide ? .35 + .65 * Math.min(1, Math.max(0, (x / W - .3) / .35)) : 1);

  // A ridge line: a few sine waves for the shape, with sharper peaks where asked.
  const ridge = (y0, amp, peaky, f) => {
    const p = [R(0, 6), R(0, 6), R(0, 6)], pts = [];
    for (let x = -10; x <= W + 10; x += 6) {
      const u = x / f;
      let h = .55 * Math.sin(u + p[0]) + .3 * Math.sin(u * 2.3 + p[1]) + .15 * Math.sin(u * 5.1 + p[2]);
      if (peaky) h = 1 - Math.abs(h) * 1.6;
      pts.push([x, y0 - amp * calm(x) * (h * .5 + .5)]);
    }
    return pts;
  };
  const fillUnder = (pts, fill, bottom = H) => {
    ctx.beginPath(); ctx.moveTo(pts[0][0], bottom);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts.at(-1)[0], bottom); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  const grad = (y0, y1, c0, c1) => { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, css(c0)); g.addColorStop(1, css(c1)); return g; };

  // 1. Far mountains, hazy, with snow on the peaks in winter.
  const span = Math.max(W, 1000); // phones see a slice of the same range, not a squeezed one
  const far = ridge(G - H * .13, H * (wide ? .15 : .14), true, span * .09);
  fillUnder(far, grad(G - H * .37, G, lit(L.far, .1), lit(L.near, .1)));
  // The shaded face of each peak: from the summit down its right-hand slope to the next valley, then a crease
  // back up to the summit.
  ctx.fillStyle = css(lit(L.near, .05), .4);
  for (let i = 1; i < far.length - 1; i++) {
    if (!(far[i][1] < far[i - 1][1] && far[i][1] <= far[i + 1][1])) continue; // a summit
    let j = i + 1; while (j < far.length - 1 && far[j + 1][1] >= far[j][1]) j++; // down to the valley
    const [px, py] = far[i], [vx, vy] = far[j];
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let k = i + 1; k <= j; k++) ctx.lineTo(...far[k]);
    ctx.lineTo(vx, vy + 6); ctx.lineTo(px + (vx - px) * .25, vy + 6); ctx.closePath(); ctx.fill();
  }
  if (season === "winter" || season === "spring") {
    const top = Math.min(...far.map((p) => p[1])), line = top + (season === "winter" ? H * .07 : H * .025);
    ctx.save(); ctx.beginPath(); ctx.moveTo(far[0][0], H); for (const [x, y] of far) ctx.lineTo(x, y); ctx.lineTo(far.at(-1)[0], H); ctx.clip();
    ctx.fillStyle = css(lit("#ffffff", .05), .92); ctx.beginPath(); ctx.moveTo(0, top - 5);
    for (let x = 0; x <= W; x += 12) ctx.lineTo(x, line + Math.sin(x * .09) * 4 + R(-2, 2)); ctx.lineTo(W, top - 5); ctx.fill(); ctx.restore();
  }

  // 2. Nearer, rounder mountains.
  const near = ridge(G - H * .095, H * .07, false, span * .12);
  fillUnder(near, grad(G - H * .22, G, lit(L.near), lit(L.trees, .1)));

  // 3. A tree line along the foot of the mountains: little conifers and round trees in clusters.
  const lineY = G - H * .085;
  for (let x = -6; x < W + 6; x += R(3, 7)) {
    const cluster = Math.sin(x / W * 9 + seed) * .5 + .5;
    if (rand() > .25 + cluster * .7) continue;
    const y = lineY + Math.sin(x * .01 + seed) * 4, h = R(7, 16) * (wide ? 1 : .8);
    if (rand() < .7) {
      // A fir: a narrow spire of stacked tiers.
      ctx.fillStyle = css(lit(L.trees));
      ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * .28, y); ctx.lineTo(x - h * .28, y); ctx.fill();
      if (season === "winter") { ctx.fillStyle = css(lit("#ffffff"), .85); ctx.beginPath(); ctx.moveTo(x, y - h); ctx.lineTo(x + h * .1, y - h * .62); ctx.lineTo(x - h * .1, y - h * .62); ctx.fill(); }
    } else {
      const c = season === "fall" ? ["#c8642a", "#d9a03a", "#a8441e"][Math.floor(R(0, 3))] : season === "winter" ? "#6d7c80" : L.trees;
      ctx.fillStyle = css(lit(c)); ctx.beginPath(); ctx.ellipse(x, y - h * .35, h * .32, h * .38, 0, 0, 7); ctx.fill();
    }
  }

  // 4. Rolling hills, far then near, each with a sunlit rim.
  const hill = (base, amp, f, c0, c1) => {
    const p = R(0, 6), pts = [];
    for (let x = -10; x <= W + 10; x += 8) pts.push([x, base - amp * (Math.sin(x / f + p) * .6 + Math.sin(x / f * 2.1 + p * 2) * .4)]);
    fillUnder(pts, grad(base - amp, G + 10, lit(c0), lit(c1)));
    ctx.strokeStyle = css(lit(L.sun), .55); ctx.lineWidth = 2;
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y + 1) : ctx.moveTo(x, y + 1))); ctx.stroke();
    return pts;
  };
  hill(G - H * .06, H * .025, span * .16, L.hillFar, L.hillNear);
  const front = hill(G - H * .02, H * .02, span * .22, L.meadow[0], L.meadow[1]);

  // Bushes along the hills, at the sides.
  const bush = (x, y, s) => {
    const [d, b, l] = L.bush.map((c) => lit(c));
    // A dome of leafy clumps: biggest and highest in the middle.
    const blobs = Array.from({ length: 5 }, (_, i) => { const m = 1 - Math.abs(i - 2) / 2.6; return [x + (i - 2) * s * .3 + R(-2, 2), y - s * (.18 + .42 * m) + R(-2, 2), s * (.26 + .2 * m) * R(.9, 1.1)]; });
    blobs.push([x + R(-3, 3), y - s * .85, s * .3]);
    ctx.fillStyle = css(d); for (const [bx, by, r] of blobs) { ctx.beginPath(); ctx.arc(bx + 2, by + 3, r, 0, 7); ctx.fill(); }
    ctx.fillStyle = css(b); for (const [bx, by, r] of blobs) { ctx.beginPath(); ctx.arc(bx, by, r * .92, 0, 7); ctx.fill(); }
    ctx.fillStyle = css(l, season === "winter" ? .95 : .7); for (const [bx, by, r] of blobs) { ctx.beginPath(); ctx.ellipse(bx - r * .25, by - r * .45, r * .5, r * (season === "winter" ? .35 : .3), 0, 0, 7); ctx.fill(); }
  };
  // None under the headline on wide screens.
  const bushes = wide ? [[.5, -2], [.6, 4], [.93, 4]] : [[.08, 2], [.9, 0]];
  for (const [fx, dy] of bushes) bush(fx * W, G - H * .045 + dy, wide ? R(26, 38) : R(18, 24));

  // 5. The meadow: patches of cloud shadow and sun, then grass, flowers and fallen leaves.
  ctx.save(); ctx.beginPath(); ctx.moveTo(front[0][0], H); for (const [x, y] of front) ctx.lineTo(x, y); ctx.lineTo(front.at(-1)[0], H); ctx.clip();
  for (let i = 0; i < (wide ? 7 : 4); i++) {
    const cx = R(0, W), cy = R(G - H * .01, H), rx = R(W * .08, W * .22), ry = R(6, 16), shadow = i % 2 === 0;
    ctx.fillStyle = css(lit(shadow ? L.shadow : L.sun), shadow ? .45 : .35);
    ctx.beginPath();
    for (let a = 0; a <= 6.3; a += .35) { const k = 1 + Math.sin(a * 3 + i) * .18; ctx[a ? "lineTo" : "moveTo"](cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k); }
    ctx.fill();
  }
  // Grass blades in tufts, smaller and paler toward the hills, longer up front.
  const blades = L.blades.map(() => new Path2D());
  const n = season === "winter" ? (wide ? 160 : 70) : wide ? 1700 : 650;
  for (let i = 0; i < n; i++) {
    const t = Math.pow(rand(), .7), y = G - H * .03 + t * (H - G + H * .03), x = R(-5, W + 5), len = 2 + t * (wide ? 9 : 7);
    if (wide && x < W * .42 && y < G + 6 && rand() < .8) continue; // keep it calm behind the words
    const p = blades[Math.floor(R(0, blades.length))];
    for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + (k - 1) * .35 + R(-.15, .15); p.moveTo(x + k * 1.2, y); p.quadraticCurveTo(x + k * 1.2 + Math.cos(a) * len * .5, y + Math.sin(a) * len * .6, x + k * 1.2 + Math.cos(a) * len, y + Math.sin(a) * len); }
  }
  ctx.lineWidth = wide ? 1.1 : 1; ctx.lineCap = "round";
  blades.forEach((p, i) => { ctx.strokeStyle = css(lit(L.blades[i]), .9); ctx.stroke(p); });
  // Wildflowers in spring and summer; fallen leaves in autumn.
  const dots = season === "spring" ? (wide ? 260 : 110) : season === "summer" ? (wide ? 110 : 45) : season === "fall" ? (wide ? 160 : 70) : 0;
  const FLOWERS = season === "fall" ? ["#d9541f", "#e8892a", "#c0391b", "#f2b23a"] : ["#ffffff", "#ffd23f", "#f48fb1", "#ef3b36", "#b38be6"];
  for (let i = 0; i < dots; i++) {
    const t = Math.pow(rand(), .6), y = G - H * .02 + t * (H - G), x = R(0, W), s = .9 + t * (wide ? 2.4 : 1.8);
    if (wide && x < W * .42 && y < G + 6) continue;
    const c = lit(FLOWERS[Math.floor(R(0, FLOWERS.length))]);
    if (season === "fall") { ctx.fillStyle = css(c); ctx.beginPath(); ctx.ellipse(x, y, s * 1.3, s * .7, R(0, 3), 0, 7); ctx.fill(); continue; }
    ctx.strokeStyle = css(lit("#4f8a2e"), .8); ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(x, y + s * 2.4); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = css(c); for (let k = 0; k < 5; k++) { const a = k * 1.256; ctx.beginPath(); ctx.arc(x + Math.cos(a) * s * .7, y + Math.sin(a) * s * .7, s * .55, 0, 7); ctx.fill(); }
    ctx.fillStyle = css(lit("#f2b23a")); ctx.beginPath(); ctx.arc(x, y, s * .4, 0, 7); ctx.fill();
  }
  ctx.restore();

  // 6. A few rocks at the edges, with a lit top, a shaded side and grass at their feet.
  const rock = (x, y, s) => {
    const pts = Array.from({ length: 7 }, (_, i) => { const a = Math.PI + (i / 6) * Math.PI; return [x + Math.cos(a) * s * R(.9, 1.1), y + Math.sin(a) * s * R(.5, .7)]; });
    ctx.fillStyle = css(lit("#8f979c")); ctx.beginPath(); ctx.moveTo(x - s, y); pts.forEach((p) => ctx.lineTo(...p)); ctx.lineTo(x + s, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(lit("#b9c0c4")); ctx.beginPath(); ctx.moveTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.lineTo(...pts[3]); ctx.lineTo(...pts[4]); ctx.lineTo(x + s * .1, y - s * .18); ctx.lineTo(x - s * .55, y - s * .15); ctx.closePath(); ctx.fill();
    ctx.fillStyle = css(lit("#6f777c"), .7); ctx.beginPath(); ctx.moveTo(...pts[5]); ctx.lineTo(...pts[6]); ctx.lineTo(x + s, y); ctx.lineTo(x + s * .2, y); ctx.lineTo(x + s * .1, y - s * .18); ctx.closePath(); ctx.fill();
    if (season === "winter") { ctx.fillStyle = css(lit("#ffffff")); ctx.beginPath(); ctx.ellipse(x - s * .15, y - s * .5, s * .6, s * .16, -.05, 0, 7); ctx.fill(); }
    else { ctx.strokeStyle = css(lit(L.blades[0])); ctx.lineWidth = 1.2; ctx.beginPath(); for (let k = 0; k < 7; k++) { const bx = x - s + k * s * .33; ctx.moveTo(bx, y + 1); ctx.lineTo(bx + R(-2, 2), y - R(4, 8)); } ctx.stroke(); }
  };
  const rocks = wide ? [[.07, H - 30, 22], [.62, G + 14, 12], [.95, H - 34, 26]] : [[.9, H - 30, 16]];
  for (const [fx, y, s] of rocks) rock(fx * W, y, s);

  // 7. The page's cream edge at the very bottom, as before.
  ctx.fillStyle = opts.page || getComputedStyle(canvas).getPropertyValue("--page").trim() || "#fff7ec";
  ctx.beginPath(); ctx.moveTo(0, H - 22 * (W / 1440) * 1.4);
  ctx.bezierCurveTo(W * .25, H - 30, W * .5, H - 30, W * .75, H - 20); ctx.bezierCurveTo(W * .88, H - 16, W * .96, H - 18, W, H - 22); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
}

return drawLandscape;
})();

const drawOwnTree = (function () {
// Procedural trees on a canvas: aspen, larch and maple through the seasons and times of day.
// drawTree(canvas, { species, season, phase, seed, clearTrunk }) draws one tree standing at the bottom centre.

const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const mixRGB = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const css = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
// Light of the hour: night is dark and moonlit, dusk warm, dawn soft.
const PHASE = { day: null, dawn: [[255, 217, 192], .1], dusk: [[110, 60, 80], .22], night: [[12, 26, 48], .6] };
const lit = (rgb, phase) => (PHASE[phase] ? mixRGB(rgb, PHASE[phase][0], PHASE[phase][1]) : rgb);

// Foliage colours: deep shade, base, sunlit.
const FOLIAGE = {
  aspen: { spring: ["#5f8f2e", "#9ccc5a", "#d4f08e"], summer: ["#2f6a2a", "#5f9a3c", "#a6d06a"], fall: ["#a8730c", "#f0bf2a", "#ffe57a"] },
  larch: { spring: ["#6f9a2a", "#a9d65a", "#dcf595"], summer: ["#3f7a34", "#6aa84f", "#a9d47f"], fall: ["#9a6a14", "#e2b43c", "#ffd970"] },
  maple: { spring: ["#4f7f2e", "#8fc25a", "#c9eb8c"], summer: ["#285f27", "#4e8f3a", "#8fc56a"], fall: ["#b86a14", "#f5a623", "#ffe9a0"] },
};
const BARK = { aspen: ["#d9d4c7", "#f4f1e8", "#3a3632"], larch: ["#5a3a28", "#7d5238", "#3a2418"], maple: ["#2e2622", "#4a3d35", "#1e1815"] };
// Branch and twig colours (aspen's white bark gives way to grey branches).
const TWIG = { aspen: ["#9a948a", "#6f675d"], larch: ["#5e3f2c", "#4a3123"], maple: ["#3a302a", "#2e2622"] };

function drawTree(canvas, opts = {}) {
  const { species = "aspen", season = "summer", phase = "day", seed = 1, clearTrunk = .35 } = opts;
  const dpr = paintRatio(), W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const rand = rng(seed * 9973 + species.length * 31);
  const R = (a, b) => a + rand() * (b - a);
  const T = H * .86, baseX = W / 2, baseY = H - 8; // tree height and foot
  const bare = season === "winter";
  const [barkShade, barkLight, barkMark] = BARK[species].map((c) => lit(hex(c), phase));
  const [branchCol, twigCol] = TWIG[species].map((c) => lit(hex(c), phase));

  // Soft shadow on the ground, cast to the lower right.
  const sh = ctx.createRadialGradient(baseX + T * .1, baseY, 0, baseX + T * .1, baseY, T * .2);
  sh.addColorStop(0, `rgba(20,40,30,${phase === "night" ? .25 : .3})`); sh.addColorStop(1, "rgba(20,40,30,0)");
  ctx.save(); ctx.translate(baseX + T * .1, baseY); ctx.scale(1, .16); ctx.translate(-(baseX + T * .1), -baseY);
  ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(baseX + T * .1, baseY, T * .2, 0, 7); ctx.fill(); ctx.restore();

  const limbs = [];   // { pts: [[x,y]...], w0, w1, depth }
  const leaves = [];  // { x, y, a, s, back }
  const tufts = [];   // larch needle tufts { x, y, back }
  const catkins = [];
  const carpet = [];  // fallen leaves

  // A limb as a curve sampled into points, so it can be drawn tapering and leaves can be hung along it.
  const curve = (x, y, ang, len, droop, wiggle = .15) => {
    const pts = [[x, y]]; let a = ang;
    const n = Math.max(3, Math.round(len / 4));
    for (let i = 1; i <= n; i++) {
      a += (rand() - .5) * wiggle + droop / n;
      x += Math.cos(a) * len / n; y += Math.sin(a) * len / n;
      pts.push([x, y]);
    }
    return pts;
  };
  const dirAt = (pts, i) => { const [x0, y0] = pts[Math.max(0, i - 1)], [x1, y1] = pts[Math.min(pts.length - 1, i + 1)]; return Math.atan2(y1 - y0, x1 - x0); };

  if (species === "aspen") {
    // One straight leader to the top, branches climbing it at a steep angle; a tall oval crown.
    const trunk = curve(baseX, baseY, -Math.PI / 2, T, 0, .02);
    limbs.push({ pts: trunk, w0: T * .036, w1: 1, depth: 0, trunk: true });
    const nb = 34;
    for (let i = 0; i < nb; i++) {
      const u = clearTrunk + (1 - clearTrunk) * (i + R(-.3, .3)) / nb;
      const [tx, ty] = trunk[Math.round(u * (trunk.length - 1))];
      const env = Math.pow(Math.sin(Math.PI * Math.min(1, (u - clearTrunk) / (1 - clearTrunk) * .92 + .08)), .75);
      const side = i % 2 ? 1 : -1, len = T * .3 * env * R(.75, 1.1);
      const ang = -Math.PI / 2 + side * R(.45, .85);
      const pts = curve(tx, ty, ang, len, -side * .25, .2);
      limbs.push({ pts, w0: T * .036 * (1 - u) * .6 + 1.2, w1: .6, depth: 1 });
      for (let j = 2; j < pts.length - 1; j += 2) {
        const d = dirAt(pts, j), sub = curve(...pts[j], d + (rand() < .5 ? -1 : 1) * R(.4, .9), len * R(.25, .45), -.1, .3);
        limbs.push({ pts: sub, w0: .9, w1: .4, depth: 2 });
        for (let k = 1; k < sub.length; k++) for (let m = 0; m < 4; m++)
          leaves.push({ x: sub[k][0] + R(-6, 6), y: sub[k][1] + R(-6, 5), a: R(0, 6.3), s: R(2.2, 3.4), back: rand() < .4 });
        if (bare) for (let k = 1; k < sub.length; k += 2) limbs.push({ pts: curve(...sub[k], dirAt(sub, k) + R(-1, 1), R(4, 9), 0, .4), w0: .5, w1: .3, depth: 3 });
        if (season === "spring" && rand() < .5) catkins.push(sub.at(-1));
      }
      for (let k = Math.floor(pts.length / 2); k < pts.length; k++) for (let m = 0; m < 3; m++)
        leaves.push({ x: pts[k][0] + R(-7, 7), y: pts[k][1] + R(-7, 6), a: R(0, 6.3), s: R(2.2, 3.4), back: rand() < .4 });
    }
    // Leaves around the top of the leader.
    for (let k = Math.round(trunk.length * .82); k < trunk.length; k++) for (let m = 0; m < 6; m++)
      leaves.push({ x: trunk[k][0] + R(-9, 9), y: trunk[k][1] + R(-6, 6), a: R(0, 6.3), s: R(2.2, 3.2), back: rand() < .4 });
  } else if (species === "larch") {
    // A straight leader; near-level branches all the way up, longest low down, drooping then lifting at the tip,
    // with branchlets hanging from them carrying tufts of needles.
    const trunk = curve(baseX, baseY, -Math.PI / 2, T, 0, .015);
    limbs.push({ pts: trunk, w0: T * .03, w1: .8, depth: 0, trunk: true });
    const nb = 40;
    for (let i = 0; i < nb; i++) {
      const u = clearTrunk + (1 - clearTrunk) * (i + R(-.3, .3)) / nb;
      const [tx, ty] = trunk[Math.round(Math.min(.995, u) * (trunk.length - 1))];
      const depthIn = rand() < .3; // some branches point toward or away from us and look shorter
      const len = (T * .3 * Math.pow(1 - (u - clearTrunk) / (1 - clearTrunk), .85) + 6) * (depthIn ? .45 : R(.8, 1.1));
      const side = i % 2 ? 1 : -1, ang = side > 0 ? R(.05, .35) : Math.PI - R(.05, .35);
      const pts = curve(tx, ty, ang, len, side * R(.25, .5), .12);
      // Lift the outer third a little, as larch branch tips turn up.
      for (let k = Math.floor(pts.length * .66); k < pts.length; k++) pts[k][1] -= (k - pts.length * .66) * .9;
      limbs.push({ pts, w0: T * .01 * (1 - u) + .7, w1: .3, depth: 1 });
      for (let k = 1; k < pts.length; k++) {
        if (rand() < .15) continue;
        const hang = curve(...pts[k], Math.PI / 2 + R(-.5, .5) - side * .3, R(6, 15) * (1 - u * .4), side * .2, .3);
        limbs.push({ pts: hang, w0: .55, w1: .3, depth: 2 });
        if (!bare) for (let m = 1; m < hang.length; m++) tufts.push({ x: hang[m][0], y: hang[m][1], back: rand() < .35 });
        else if (rand() < .4) tufts.push({ x: hang.at(-1)[0], y: hang.at(-1)[1], knob: true });
      }
    }
    for (let k = Math.round(trunk.length * .9); k < trunk.length; k++) if (!bare) tufts.push({ x: trunk[k][0] + R(-3, 3), y: trunk[k][1], back: false });
  } else {
    // Maple, like a mature sugar maple: a thick trunk that forks low into heavy limbs sweeping outward and up,
    // under a broad dome of leaves with gaps where the dark limbs show through.
    const fork = T * Math.max(.3, clearTrunk + .02);
    const trunk = curve(baseX, baseY, -Math.PI / 2 + R(-.04, .04), fork, R(-.06, .06), .03);
    const tw = T * .075;
    limbs.push({ pts: trunk, w0: tw, w1: tw * .72, depth: 0, trunk: true, flare: true });
    const crownW = Math.min(W * .48, T * .46), top = baseY - T;
    const grow = (x, y, ang, len, w, depth) => {
      const pts = curve(x, y, ang, len, R(-.12, .12) - Math.cos(ang) * .3, .16);
      limbs.push({ pts, w0: w, w1: w * .6, depth });
      if (depth >= 3) for (let k = 1; k < pts.length; k++) for (let m = 0; m < (depth >= 4 ? 5 : 2); m++)
        leaves.push({ x: pts[k][0] + R(-7, 7), y: pts[k][1] + R(-7, 6), a: R(0, 6.3), s: R(2.6, 3.6), back: rand() < .4 });
      if (depth === 5) return;
      const n = depth === 1 ? 3 : 2 + (rand() < .45);
      for (let i = 0; i < n; i++) {
        let a = ang + (i - (n - 1) / 2) * R(.45, .7) + R(-.2, .2);
        a += (-Math.PI / 2 - a) * (depth === 1 ? .3 : .38); // later growth turns upward
        grow(...pts[Math.max(1, Math.round(pts.length * R(.6, 1)) - 1)], a, len * R(.6, .74), w * .6, depth + 1);
      }
    };
    // Four or five big limbs from the fork, fanning from nearly level to upright, plus a leader up the middle.
    const [fx, fy] = trunk.at(-1), nl = 4 + (rand() < .5), firstLimb = limbs.length, firstLeaf = leaves.length;
    for (let i = 0; i < nl; i++) {
      const f = i / (nl - 1), a = -Math.PI + .78 + f * (Math.PI - 1.56) + R(-.1, .1);
      grow(fx + R(-tw * .2, tw * .2), fy + R(0, T * .03), a, T * .3 * R(.85, 1.05), tw * .48, 1);
    }
    grow(fx, fy, -Math.PI / 2 + R(-.1, .1), T * .28, tw * .42, 1);
    // Then scale the whole crown about the fork so it fills the space: as wide as allowed, up to the top.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity;
    for (const l of limbs.slice(firstLimb)) for (const [x, y] of l.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); }
    for (const l of leaves.slice(firstLeaf)) { x0 = Math.min(x0, l.x - 8); x1 = Math.max(x1, l.x + 8); y0 = Math.min(y0, l.y - 8); }
    const k = Math.min((crownW * 2) / (x1 - x0), (fy - top) / (fy - y0)), cxm = (x0 + x1) / 2;
    const fit = (p) => [fx + (p[0] - cxm) * k, fy + (p[1] - fy) * k];
    for (const l of limbs.slice(firstLimb)) { l.pts = l.pts.map(fit); l.w0 *= Math.min(1, k); l.w1 *= Math.min(1, k); }
    for (const l of leaves.slice(firstLeaf)) [l.x, l.y] = fit([l.x, l.y]);
    // In autumn the ground under a maple is carpeted.
    if (season === "fall") for (let i = 0; i < 90; i++) {
      const a = R(0, 6.3), d = Math.sqrt(rand());
      carpet.push({ x: baseX + T * .05 + Math.cos(a) * crownW * 1.05 * d, y: baseY - 2 + Math.sin(a) * 5 * d, a: R(0, 6.3), s: R(2.2, 3.2) });
    }
  }

  // Lighting: foliage near the crown's sunlit upper left is bright, the inside and the far side dark.
  const pool = species === "larch" ? tufts.filter((t) => !t.knob) : leaves;
  let cx = baseX, cy = baseY - T * .6, rx = T * .2, ry = T * .3;
  if (pool.length) {
    const xs = pool.map((p) => p.x), ys = pool.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    cx = (x0 + x1) / 2; cy = (y0 + y1) / 2; rx = (x1 - x0) / 2 || 1; ry = (y1 - y0) / 2 || 1;
  }
  const shade = (x, y, back) => {
    const nx = (x - cx) / rx, ny = (y - cy) / ry, r = Math.min(1, Math.hypot(nx, ny));
    const sun = (-.6 * nx - .8 * ny) / (r || 1) * r;
    return Math.max(0, Math.min(1, .55 + .38 * sun - .28 * (1 - r) - (back ? .22 : 0) + R(-.12, .12)));
  };
  const BUCKETS = 10;
  const palette = !bare && FOLIAGE[species][season].map((c) => lit(hex(c), phase));
  const colourAt = (b) => { const t = b / (BUCKETS - 1); return t < .55 ? mixRGB(palette[0], palette[1], t / .55) : mixRGB(palette[1], palette[2], (t - .55) / .45); };

  const drawLeaves = (back) => {
    if (bare) return;
    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    if (species === "larch") {
      for (const t of tufts) if (!t.knob && t.back === back) {
        const p = paths[Math.round(shade(t.x, t.y, back) * (BUCKETS - 1))];
        for (let m = 0; m < 9; m++) { const a = Math.PI / 2 + R(-1.5, 1.5), l = R(1.8, 3.4); p.moveTo(t.x, t.y); p.lineTo(t.x + Math.cos(a) * l, t.y + Math.sin(a) * l); }
      }
      ctx.lineWidth = .7; ctx.lineCap = "round";
      paths.forEach((p, b) => { ctx.strokeStyle = css(colourAt(b)); ctx.stroke(p); });
      return;
    }
    // Leaves are little pointed ovals at random angles; maples' are a touch larger and rounder.
    const thin = species === "aspen" ? .62 : .8;
    // Autumn mixes in a few odd colours: red in maples, orange in aspens. They go underneath the rest.
    const odd = new Path2D(), oddShare = season === "fall" ? (species === "maple" ? .14 : .04) : 0;
    for (const l of leaves) if (l.back === back) {
      if (season === "spring" && rand() < .35) continue; // spring crowns are still filling in
      const p = rand() < oddShare ? odd : paths[Math.round(shade(l.x, l.y, back) * (BUCKETS - 1))];
      const c = Math.cos(l.a), s = Math.sin(l.a), L = l.s, w = l.s * thin;
      p.moveTo(l.x + c * L, l.y + s * L);
      p.quadraticCurveTo(l.x - s * w, l.y + c * w, l.x - c * L, l.y - s * L);
      p.quadraticCurveTo(l.x + s * w, l.y - c * w, l.x + c * L, l.y + s * L);
    }
    if (oddShare) { ctx.fillStyle = css(lit(hex(species === "maple" ? "#c8321f" : "#e8742a"), phase)); ctx.fill(odd); }
    paths.forEach((p, b) => { ctx.fillStyle = css(colourAt(b)); ctx.fill(p); });
  };

  const drawLimbs = () => {
    // Thicker first, so twigs sit on top of limbs.
    for (const l of [...limbs].sort((a, b) => a.depth - b.depth)) {
      const n = l.pts.length;
      for (let i = 1; i < n; i++) {
        const w = l.w0 + (l.w1 - l.w0) * (i / (n - 1));
        ctx.strokeStyle = css(l.trunk ? barkLight : l.depth === 1 && species === "aspen" && i < n * .3 ? barkShade : l.depth === 1 ? branchCol : twigCol);
        ctx.lineWidth = w; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(...l.pts[i - 1]); ctx.lineTo(...l.pts[i]); ctx.stroke();
      }
      if (l.trunk) {
        // Shade the right side of the trunk, then the bark's markings.
        for (let i = 1; i < n; i++) {
          const w = l.w0 + (l.w1 - l.w0) * (i / (n - 1));
          ctx.strokeStyle = css(barkShade, .9); ctx.lineWidth = w * .4;
          ctx.beginPath(); ctx.moveTo(l.pts[i - 1][0] + w * .28, l.pts[i - 1][1]); ctx.lineTo(l.pts[i][0] + w * .28, l.pts[i][1]); ctx.stroke();
        }
        ctx.fillStyle = css(barkMark, species === "aspen" ? .85 : .5);
        const marks = species === "aspen" ? 40 : 24;
        for (let m = 0; m < marks; m++) {
          const i = Math.floor(R(1, n * (species === "maple" ? 1 : .8))), [x, y] = l.pts[i];
          const w = l.w0 + (l.w1 - l.w0) * (i / (n - 1));
          if (species === "aspen") { ctx.beginPath(); ctx.ellipse(x + R(-w * .3, w * .3), y, w * R(.15, .45), R(.6, 1.4), 0, 0, 7); ctx.fill(); }
          else { ctx.fillRect(x + R(-w * .4, w * .2), y, R(.8, 1.4), R(3, 8)); }
        }
      }
    }
    // Winter larch keeps little cone-like knobs; spring aspen dangles catkins.
    ctx.fillStyle = css(barkShade);
    for (const t of tufts) if (t.knob) { ctx.beginPath(); ctx.arc(t.x, t.y, 1.1, 0, 7); ctx.fill(); }
    ctx.strokeStyle = css(lit(hex("#b7a77a"), phase)); ctx.lineWidth = 1.6;
    for (const [x, y] of catkins) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 1.5, y + 4, x, y + 7); ctx.stroke(); }
  };

  if (carpet.length) {
    const cols = ["#ec8a24", "#f4b52a", "#d9541f", "#b0661a"].map((c) => lit(hex(c), phase));
    cols.forEach((c, i) => { const p = new Path2D(); carpet.forEach((l, j) => { if (j % 4 === i) { p.moveTo(l.x + l.s, l.y); p.ellipse(l.x, l.y, l.s, l.s * .55, l.a, 0, 7); } }); ctx.fillStyle = css(c); ctx.fill(p); });
  }
  if (limbs[0].flare) {
    // Roots flare into the ground.
    const w = limbs[0].w0; ctx.fillStyle = css(barkLight);
    ctx.beginPath(); ctx.moveTo(baseX - w * 1.1, baseY + 1); ctx.quadraticCurveTo(baseX - w * .5, baseY - w * .3, baseX - w * .45, baseY - w * 1.2);
    ctx.lineTo(baseX + w * .45, baseY - w * 1.2); ctx.quadraticCurveTo(baseX + w * .5, baseY - w * .3, baseX + w * 1.15, baseY + 1); ctx.closePath(); ctx.fill();
  }
  drawLeaves(true);
  drawLimbs();
  drawLeaves(false);
}

return drawTree;
})();

const drawGptTree = (function () {
/** Deterministic, dependency-free botanical canvas illustrations. */
function drawTree(canvas, opts = {}) {
  const {species = 'aspen', season = 'fall', phase = 'day', seed = 1} = opts;
  const clear = Math.max(0.1, Math.min(0.72, opts.clearTrunk ?? 0.35));
  const width = canvas.clientWidth || 220, height = canvas.clientHeight || 360;
  const dpr = paintRatio();
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr * width / 220, 0, 0, dpr * height / 360, 0, 0);
  let state = (Number(seed) || 0) >>> 0;
  const rnd = () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const range = (a,b) => a + (b-a)*rnd();
  const tint = (rgb, light=1) => {
    const p = {day:[1,1,1], dawn:[1.02,.94,.90], dusk:[1.06,.75,.58], night:[.24,.36,.57]}[phase] || [1,1,1];
    return `rgb(${rgb.map((v,i)=>Math.max(0,Math.min(255,Math.round(phase==='night' ? (v*[.36,.42,.52][i]+[10,18,34][i])*light : v*light*p[i])))).join(',')})`;
  };
  c.save(); c.translate(131,357); c.scale(1,.12);
  const ground=c.createRadialGradient(0,0,0,0,0,54); ground.addColorStop(0,'rgba(30,45,56,.24)'); ground.addColorStop(1,'rgba(30,45,56,0)');
  c.fillStyle=ground; c.beginPath(); c.arc(0,0,54,0,Math.PI*2); c.fill(); c.restore();
  const H=338, base=360, top=base-H;
  const trunkX=y=>110 + Math.sin((base-y)/H*2.7)* (species==='larch'?1.5:3);
  const foliage=[]; const wood=[];
  function segment(x,y,ex,ey,w,depth=0) {
    wood.push({x,y,ex,ey,w,depth});
  }
  function leafyTwig(x,y,angle,len,depth,w) {
    const bend=range(-.15,.15), ex=x+Math.cos(angle+bend)*len, ey=y+Math.sin(angle+bend)*len;
    segment(x,y,ex,ey,w,depth);
    if(depth<=1) {
      const count=species==='maple'?range(6,10):range(6,10);
      for(let i=0;i<count;i++) {
        const t=range(.12,1.15), spread=(species==='maple'?5.0:4.3)*(1-.35*t);
        foliage.push({x:x+(ex-x)*t+range(-spread,spread),y:y+(ey-y)*t+range(-spread,spread),size:range(species==='maple'?1.7:1.05,species==='maple'?3:2.15),a:range(0,6.28),v:rnd()});
      }
    }
    if(depth===4) {
      for(let i=0;i<2;i++) {
        const t=.22+i*.35;
        leafyTwig(x+(ex-x)*t,y+(ey-y)*t,-Math.PI/2+range(-.95,.95),range(10,19),2,w*.32);
      }
    }
    if(depth>0) {
      leafyTwig(ex,ey,angle+range(-.28,.2),len*range(.58,.75),depth-1,w*.60);
      const t=range(.4,.8), side=rnd()<.5?-1:1;
      leafyTwig(x+(ex-x)*t,y+(ey-y)*t,angle+side*range(.42,.88),len*range(.43,.65),depth-1,w*.48);
    }
  }
  if(species==='larch') {
    // One uninterrupted leader, radial horizontal limbs, pendant short shoots.
    const levels=24;
    for(let j=0;j<levels;j++) {
      const f=clear+(1-clear)*(j/(levels-1)), y=base-H*f+range(-2.5,2.5);
      const envelope=85*Math.pow(1-(f-clear)/(1-clear),.84)+1;
      for(let k=0;k<3;k++) {
        const az=j*2.399+k*2.094+range(-.22,.22), projection=Math.cos(az);
        const reach=envelope*projection*range(.76,1.12), depth=Math.sin(az), x=trunkX(y);
        const ey=y+range(3,12)*(1-f)+depth*4;
        const ex=x+reach;
        const n=Math.max(4,Math.floor(Math.abs(reach)/3.8));
        let px=x,py=y;
        for(let i=1;i<=n;i++) {
          const t=i/n, xx=x+reach*t, yy=y+(ey-y)*t+12*Math.sin(t*Math.PI)*(1-f)-5*t*t*t;
          segment(px,py,xx,yy,Math.max(.24,1.8*(1-f)*(1-t)+.2),depth);
          // Soft descending branchlets attach individually; tips curl upward.
          for(let b=0;b<2;b++) {
            const hang=range(9,27)*(1-.6*f), dx=range(-4,4)+reach*.04;
            const bx=xx+dx, by=yy+hang;
            segment(xx,yy,bx,by,.28,depth);
            segment(bx,by,bx+range(-1.4,1.4),by-2,.18,depth);
            for(let q=0;q<4;q++) {
              const u=(q+range(0,.6))/4;
              foliage.push({x:xx+dx*u,y:yy+hang*u,size:range(1.9,3.6),a:range(-.4,.4),v:rnd(),needle:true});
            }
          }
          px=xx;py=yy;
        }
      }
    }
  } else {
    const maple=species==='maple';
    for(let j=0;j<(maple?23:25);j++) {
      const f=clear+(1-clear)*((j+.5)/(maple?23:25));
      const y=base-H*f, side=j%2?1:-1;
      const u=(f-clear)/(1-clear);
      const reach=(maple?76:67)*Math.pow(Math.sin(Math.PI*u),maple?.48:.73)*range(.73,1.12);
      const rise=range(35,65)*(1-u)+8;
      const len=Math.hypot(reach,rise)*.47;
      const angle=Math.atan2(-rise,side*reach);
      leafyTwig(trunkX(y),y,angle,len,4,2.1*(1-f)+.35);
      if(j%2===0) leafyTwig(trunkX(y),y,-Math.PI/2+range(-.7,.7),range(14,25),3,.7);
    }
    // Ascending leader twigs close the pointed, imperfect top.
    for(let k=0;k<6;k++) leafyTwig(trunkX(top+38),top+38,-Math.PI/2+range(-.4,.4),range(8,15),3,.5);
  }
  // Fit the complete ragged crown before rasterizing; tips never crop at the canvas edge.
  const crownBase=base-H*clear;
  const minY=Math.min(top,...foliage.map(p=>p.y-p.size),...wood.map(p=>Math.min(p.y,p.ey)));
  const crownTop=species==='maple'?59:24;
  const crownScale=(crownBase-crownTop)/(crownBase-minY);
  const fit=y=>y<crownBase?crownBase-(crownBase-y)*crownScale:y;
  for(const b of wood){b.y=fit(b.y);b.ey=fit(b.ey);}
  for(const p of foliage)p.y=fit(p.y);
  // Back-to-front branches, all remaining visible in winter.
  wood.sort((a,b)=>a.depth-b.depth);
  c.lineCap='round';
  for(const b of wood) {
    c.strokeStyle=tint(species==='aspen'?(b.w>.9?[159,158,131]:[113,112,84]):[100,83,51],range(.85,1.05));
    c.lineWidth=b.w; c.beginPath();c.moveTo(b.x,b.y);c.lineTo(b.ex,b.ey);c.stroke();
  }
  // Tapered bark, modeled with a lit left edge and a cool shaded right edge.
  const bark=c.createLinearGradient(species==='maple'?100:105,0,species==='maple'?121:116,0);
  const white=species==='aspen';
  const mapleBark=species==='maple';
  bark.addColorStop(0,tint(white?[251,247,223]:mapleBark?[98,84,72]:[152,130,88]));
  bark.addColorStop(.4,tint(white?[224,225,206]:mapleBark?[66,56,48]:[110,96,62]));
  bark.addColorStop(1,tint(white?[135,150,145]:mapleBark?[38,32,28]:[63,65,44]));
  const trunkH=species==='maple'?H-55:H;
  c.fillStyle=bark;c.beginPath();c.moveTo(105,base);
  const thick=species==='maple'?1.9:1;
  for(let i=0;i<=34;i++){const y=base-trunkH*i/34;c.lineTo(trunkX(y)-(1-i/34)*4.5*thick-.18,y);}
  for(let i=34;i>=0;i--){const y=base-trunkH*i/34;c.lineTo(trunkX(y)+(1-i/34)*4.1*thick+.18,y);}
  c.closePath();c.fill();
  for(let i=0;i<(white?57:95);i++) {
    const f=rnd(), y=base-trunkH*f, x=trunkX(y), w=(1-f)*4;
    c.strokeStyle=tint(white?[77,88,81]:[65,61,41],range(.8,1.2)); c.lineWidth=range(.25,.7);
    c.beginPath();
    if(white){const xx=x+range(-w,w);c.moveTo(xx,y);c.lineTo(xx+range(.4,2.8)*(1-f),y+range(-.7,.7));}
    else {const xx=x+range(-w,w);c.moveTo(xx,y);c.lineTo(xx+.3,y+range(1,6));} c.stroke();
  }
  const palettes={
    aspen:{spring:[151,196,64],summer:[89,145,43],fall:[238,184,27]},
    maple:{spring:[139,184,70],summer:[68,133,56],fall:[220,77,26]},
    larch:{spring:[151,190,63],summer:[86,128,53],fall:[206,161,39]}
  };
  const pal=(palettes[species]||palettes.aspen)[season]||[130,150,60];
  // Quantized shades allow batching thousands of small marks into 24 draw calls.
  const buckets=Array.from({length:24},()=>[]);
  for(const p of foliage) {
    const inner=1-Math.min(1,Math.abs(p.x-112)/70);
    const lower=Math.max(0,(p.y-80)/260);
    const light=.69+p.v*.49-inner*.16-lower*.08+(112-p.x)/650;
    buckets[Math.max(0,Math.min(23,Math.floor((light-.42)*26)))].push(p);
  }
  if(season!=='winter') {
    for(let k=0;k<buckets.length;k++) {
      const color=pal.slice();
      if(species==='maple'&&season==='fall') {color[1]+=k%4*13;color[0]+=k%3*8;}
      c.fillStyle=tint(color,.42+(k+.5)/26);c.strokeStyle=c.fillStyle;c.lineWidth=.52;c.beginPath();
      for(const p of buckets[k]) {
        if(p.needle) {
          for(let n=-1;n<=1;n++) {c.moveTo(p.x,p.y);c.lineTo(p.x+n*p.size*.64,p.y-p.size);}
        } else {
          // Small asymmetrical pointed blades; no canopy blobs or circles.
          const sx=Math.cos(p.a)*p.size,sy=Math.sin(p.a)*p.size;
          c.moveTo(p.x+sx,p.y+sy);c.lineTo(p.x-sy*.65,p.y+sx*.65);c.lineTo(p.x-sx,p.y-sy);c.lineTo(p.x+sy*.48,p.y-sx*.48);c.closePath();
        }
      }
      if(species==='larch')c.stroke();else c.fill();
    }
    if(species==='aspen'&&season==='spring') {
      c.strokeStyle=tint([164,139,74]);c.lineWidth=.9;
      for(let i=0;i<foliage.length;i+=140){const p=foliage[i];c.beginPath();c.moveTo(p.x,p.y);c.quadraticCurveTo(p.x+2,p.y+3,p.x+.7,p.y+4);c.stroke();}
    }
  }
  return canvas;
}

return drawTree;
})();

export const drawTree = (canvas, opts) => (opts.species === "aspen" ? drawOwnTree : drawGptTree)(canvas, opts);
