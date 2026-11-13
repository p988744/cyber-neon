// Pure district placement for the spaces map: no herdr imports, so `node` can test it.
// Returns [{ id, x, y, w, h }] inside [0, width). Position comes only from the name, so the
// same input always gives the same map (no reshuffles between renders or restarts).

// Letter of a name as 0..25; anything that isn't a-z goes to the last sector (25).
const letter = (ch) => { const i = (ch ?? "").toLowerCase().charCodeAt(0) - 97; return i >= 0 && i < 26 ? i : 25; };

// spaces: [{ id, name, tabs }]. Each region is a grid of 26 sectors, A..Z left to right then
// top to bottom; the name's first letter picks the sector, its second letter the offset inside
// it. Rows no district uses collapse, so a region is only as tall as its used rows. Collisions:
// districts go in name order and a later one moves to the nearest free spot.
export function districts(spaces, width, { gap = 4, unit = 60, rowH = [38, 48], rowGap = 0, size = 0 } = {}) {
  const cols = Math.min(26, Math.max(2, Math.floor((width + gap) / (unit + gap))));
  const sw = (width - gap * (cols - 1)) / cols, sh = rowH[1] + gap * 2 + rowGap;
  const items = [...spaces].sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)))
    .map((s) => {
      const name = String(s.name ?? "");
      const sector = letter(name[0]);
      const wide = (s.tabs ?? 0) >= 4;
      return { s, sector, off: name.length > 1 ? letter(name[1]) / 25 : 0.5, wide };
    });
  const used = [...new Set(items.map((i) => Math.floor(i.sector / cols)))].sort((a, b) => a - b);
  const rowY = (r) => used.indexOf(r) * sh;
  const placed = [];
  const hits = (x, y, w, h) => placed.some((b) => x < b.x + b.w + gap && b.x < x + w + gap && y < b.y + b.h + gap && b.y < y + h + gap);
  for (const { s, sector, off, wide } of items) {
    const w = size || Math.min(width, Math.round(wide ? sw * 1.5 : sw * 0.8)), h = size || (wide ? rowH[1] : rowH[0]);
    const sx = (sector % cols) * (sw + gap), sy = rowY(Math.floor(sector / cols));
    let x = Math.min(width - w, Math.round(sx + off * Math.max(0, sw - w)));
    let y = Math.round(sy + (1 - off) * (sh - rowGap - gap - h));
    if (hits(x, y, w, h)) {
      // Nearest free spot among the slots next to placed districts (right/left/below/above);
      // "below everything" always exists. ponytail: O(n²) candidates, fine for tens of spaces.
      const cand = [];
      for (const b of placed) for (const [cx, cy] of [[b.x + b.w + gap, y], [b.x - w - gap, y], [x, b.y + b.h + gap], [x, b.y - h - gap], [b.x + b.w + gap, b.y], [b.x, b.y + b.h + gap]])
        cand.push([Math.max(0, Math.min(width - w, cx)), cy]);
      cand.push([x, placed.reduce((m, b) => Math.max(m, b.y + b.h), 0) + gap]);
      let best = null;
      for (const [cx, cy] of cand) {
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (cy >= 0 && (!best || d < best.d || (d === best.d && (cy < best.cy || (cy === best.cy && cx < best.cx)))) && !hits(cx, cy, w, h)) best = { cx, cy, d };
      }
      ({ cx: x, cy: y } = best);
    }
    placed.push({ id: s.id, x, y, w, h });
  }
  return placed;
}

// 2-4 letter caps code: "atlas" -> ATLS, "herdr-gallery" -> HGAL.
export function code(name) {
  const words = String(name).replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) {
    const [first, ...rest] = words[0];
    const cons = rest.filter((c) => !/[aeiou]/i.test(c));
    return (first + (cons.length >= 1 ? cons : rest).join("")).slice(0, 4).toUpperCase();
  }
  const heads = words.slice(0, -1).map((w) => w[0]).join("").slice(0, 3);
  return (heads + words.at(-1)).slice(0, 4).toUpperCase();
}

// ── v4.1 look: outlines, city-block texture and roads, all from the name/boxes only.
export function hash(s) {
  let h = 0x811c9dc5; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
// mulberry32: a tiny seeded PRNG, so a district's texture never changes between renders.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function inside([px, py], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Roads between district centres (each to its nearest 1-2 neighbours, as 2-segment elbows) and
// 2-3 highways out to the region edge. Returns polylines [[x, y], ...] in region coordinates.
export function roads(boxes, width, height) {
  const c = boxes.map((b) => ({ id: String(b.id), x: Math.round(b.x + b.w / 2), y: Math.round(b.y + b.h / 2) }));
  const lines = [], seen = new Set();
  for (const a of c) {
    const near = c.filter((b) => b !== a).sort((p, q) => ((p.x - a.x) ** 2 + (p.y - a.y) ** 2) - ((q.x - a.x) ** 2 + (q.y - a.y) ** 2) || p.id.localeCompare(q.id));
    for (const b of near.slice(0, 1 + (hash(a.id) % 2))) {
      const k = [a.id, b.id].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push(hash(k) % 2 ? [[a.x, a.y], [b.x, a.y], [b.x, b.y]] : [[a.x, a.y], [a.x, b.y], [b.x, b.y]]);
    }
  }
  const picks = [...c].sort((p, q) => hash(p.id) - hash(q.id)).slice(0, Math.min(c.length, 2 + (c.length > 3 ? 1 : 0)));
  picks.forEach((p, i) => {
    const side = (hash(p.id) >>> 3) % 3; // 0 right, 1 left, 2 bottom
    const bend = (i + 1) * 6;
    if (side === 0) lines.push([[p.x, p.y], [p.x + bend, p.y + bend], [width, p.y + bend]]);
    else if (side === 1) lines.push([[p.x, p.y], [p.x - bend, p.y + bend], [0, p.y + bend]]);
    else lines.push([[p.x, p.y], [p.x + bend, p.y + bend], [p.x + bend, height]]);
  });
  return lines.map((l) => l.map(([x, y]) => [Math.max(0, Math.min(width, x)), Math.max(0, Math.min(height, y))]));
}

// ── v4.2 terrain: a landmass around a region's districts, a river, suburbs, islets.
// boxes are in region coordinates and need >= 10px of room on every side (callers inset them).
const smooth = (r, n, every) => {
  // Value noise: random knots every `every` samples, cosine-interpolated, values 0..1.
  const knots = Array.from({ length: Math.ceil(n / every) + 2 }, r);
  return (i) => { const k = Math.floor(i / every), f = (1 - Math.cos(((i % every) / every) * Math.PI)) / 2; return knots[k] * (1 - f) + knots[k + 1] * f; };
};
export function terrain(boxes, width, seed, M = 10) {
  if (!boxes.length) return { land: null, height: 24 };
  const r = rng(hash(`land:${seed}`));
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - M), x1 = Math.min(width, Math.max(...boxes.map((b) => b.x + b.w)) + M);
  const N = Math.max(12, Math.min(36, Math.round((x1 - x0) / 9)));
  const step = (x1 - x0) / N;
  const xs = Array.from({ length: N + 1 }, (_, i) => x0 + i * step);
  // Conservative profile: each sample takes every expanded cell touching its neighbours' span,
  // so the straight edge between two samples stays outside every district.
  const prof = xs.map((x) => {
    const hit = boxes.filter((b) => b.x - M < x + step && b.x + b.w + M > x - step);
    return hit.length ? [Math.min(...hit.map((b) => b.y - M)), Math.max(...hit.map((b) => b.y + b.h + M))] : null;
  });
  for (let i = 0; i <= N; i++) if (!prof[i]) {
    // A gap between columns: bridge it from the nearest known samples (one landmass).
    let a = i, b = i; while (a > 0 && !prof[a]) a--; while (b < N && !prof[b]) b++;
    const pa = prof[a] ?? prof[b], pb = prof[b] ?? prof[a];
    prof[i] = [Math.min(pa[0], pb[0]) + 6, Math.max(pa[1], pb[1]) - 6];
  }
  const nt = smooth(r, N + 1, 3), nb = smooth(r, N + 1, 3);
  // Mostly outward (bays/peninsulas up to 9px), sometimes a shallow inlet (at most 9px, never deeper than M-3).
  const wob = (v) => (v < 0.18 ? Math.min(9, M - 3) * (1 - v / 0.18) : -(v - 0.18) * 11);
  const top = xs.map((x, i) => [x, Math.round(prof[i][0] + wob(nt(i)))]);
  const bot = xs.map((x, i) => [x, Math.round(prof[i][1] - wob(nb(i)))]).reverse();
  const ends = (x, dir, ya, yb) => [[Math.max(0, Math.min(width, x + dir * Math.round(r() * 5))), Math.round((ya * 2 + yb) / 3)], [Math.max(0, Math.min(width, x + dir * Math.round(r() * 5))), Math.round((ya + yb * 2) / 3)]];
  const land = [...top, ...ends(x1, 1, top.at(-1)[1], bot[0][1]), ...bot, ...ends(x0, -1, bot.at(-1)[1], top[0][1])]
    .map(([x, y]) => [Math.round(Math.max(0, Math.min(width, x))), Math.max(0, y)]);
  const low = Math.max(...land.map((p) => p[1]));
  // River: the widest band no district touches, between the first and last row (horizontal), else
  // between the first and last column (vertical). It runs past the coast into the sea.
  const widest = (iv) => {
    const occ = iv.sort((a, b) => a[0] - b[0]);
    let band = null, end = occ[0][1];
    for (const [a, b] of occ.slice(1)) { if (a - end >= 6 && (!band || a - end > band[1] - band[0])) band = [end, a]; end = Math.max(end, b); }
    return band;
  };
  const hb = widest(boxes.map((b) => [b.y, b.y + b.h])), vb = hb ? null : widest(boxes.map((b) => [b.x, b.x + b.w]));
  let river = null;
  const band = hb ?? vb;
  if (band) {
    const gap = band[1] - band[0], rw = Math.min(8, gap - 2), amp = Math.max(0, Math.min(14, (gap - rw) / 2 - 1)), mid = (band[0] + band[1]) / 2;
    const ph = r() * Math.PI * 2, k = 1 + Math.floor(r() * 2);
    const [from, to] = hb ? [x0 - 6, x1 + 6] : [-6, Math.max(...boxes.map((b) => b.y + b.h)) + M + 14];
    const pts = Array.from({ length: 25 }, (_, i) => {
      const u = Math.round(from + (i / 24) * (to - from)), v = Math.round((mid + amp * Math.sin(ph + (i / 24) * Math.PI * 2 * k)) * 10) / 10;
      return hb ? [u, v] : [v, Math.max(0, u)];
    });
    river = { pts, w: rw, vertical: !hb, lo: mid - amp - rw / 2, hi: mid + amp + rw / 2 };
  }
  // The coast is x-monotone (top edge, bottom edge), so "on land" is a lerp, not a polygon walk.
  const edge = (pts, x) => { for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [a, b] = [pts[i - 1], pts[i]]; return a[1] + ((x - a[0]) / (b[0] - a[0] || 1)) * (b[1] - a[1]); } return pts.at(-1)[1]; };
  const botLR = [...bot].reverse();
  const onLand = ([x, y]) => x > x0 && x < x1 && y > edge(top, x) && y < edge(botLR, x);
  // City texture clusters around each point: dense within 20px, thinning out to nothing at 50px,
  // never on the point's ring (< 14px) or the river. ponytail: blocks × points scan, fine for tens of spaces.
  const cs = boxes.map((b) => [b.x + b.w / 2, b.y + b.h / 2]);
  const rs = rng(hash(`suburb:${seed}`)), suburbs = [];
  for (let y = 0; y < low;) {
    const bh = 2 + Math.floor(rs() * 4);
    for (let x = x0; x < x1;) {
      const bw = 2 + Math.floor(rs() * 4), roll = rs();
      let d = Infinity;
      for (const [px, py] of cs) d = Math.min(d, Math.hypot(x + bw / 2 - px, y + bh / 2 - py));
      const p = d < 14 || d >= 50 ? 0 : d <= 20 ? 0.8 : 0.8 * ((50 - d) / 30) ** 1.5;
      const c = [[x + 0.5, y + 0.5], [x + bw - 0.5, y + 0.5], [x + 0.5, y + bh - 0.5], [x + bw - 0.5, y + bh - 0.5]];
      if (roll < p && !(river && (river.vertical ? x < river.hi + 1 && x + bw > river.lo - 1 : y < river.hi + 1 && y + bh > river.lo - 1)) && c.every(onLand)) suburbs.push([x, y, bw, bh]);
      x += bw + 1 + Math.floor(rs() * 2);
    }
    y += bh + 1 + Math.floor(rs() * 2);
  }
  // Offshore islets below the coast.
  const ri = rng(hash(`islet:${seed}`)), islets = [];
  for (let n = 1 + Math.floor(ri() * 3); n > 0; n--) {
    const rad = 2 + ri() * 4, cx = 8 + ri() * Math.max(1, width - 16), cy = low + 5 + rad + ri() * 6;
    const poly = Array.from({ length: 6 }, (_, i) => { const a = (i / 6) * Math.PI * 2, d = rad * (0.7 + ri() * 0.5); return [Math.round((cx + Math.cos(a) * d) * 10) / 10, Math.round((cy + Math.sin(a) * d) * 10) / 10]; });
    if (poly.every((q) => !inside(q, land) && q[0] >= 0 && q[0] <= width)) islets.push(poly);
  }
  const height = Math.ceil(Math.max(low, ...islets.flat().map((q) => q[1]))) + 4;
  return { land, river, suburbs, islets, height };
}

// Where a road segment crossing the river runs straight across it, two short rails make a bridge.
export function bridges(lines, river) {
  if (!river) return [];
  const out = [], V = river.vertical;
  // The river's centre as a function of the coordinate it runs along.
  const at = (u) => { const p = river.pts.map(([x, y]) => (V ? [y, x] : [x, y])); for (let i = 1; i < p.length; i++) if (u <= p[i][0]) { const f = (u - p[i - 1][0]) / (p[i][0] - p[i - 1][0] || 1); return p[i - 1][1] + f * (p[i][1] - p[i - 1][1]); } return p.at(-1)[1]; };
  for (const l of lines) for (let i = 1; i < l.length; i++) {
    let [[ax, ay], [bx, by]] = [l[i - 1], l[i]];
    if (V) [ax, ay, bx, by] = [ay, ax, by, bx]; // work in (along, across) coordinates
    if (ax !== bx) continue;
    const c = at(ax);
    if (c > Math.min(ay, by) && c < Math.max(ay, by)) for (const d of [-1, 1]) {
      const rail = [[ax - 3, c + d * (river.w / 2 + 1)], [ax + 3, c + d * (river.w / 2 + 1)]];
      out.push(V ? rail.map(([u, v]) => [v, u]) : rail);
    }
  }
  return out;
}

// ── v4.3 labels: a two-line tag per point (`NN NAME` / details), joined to the point's ring by a
// leader line. Candidates NE, E, SE, NW, W, SW, N, S at 14-30px; then the name shrinks with "…";
// then the nearest free spot. A tag never covers another tag or any point (PR keep-out circle),
// its leader never crosses another tag, and no earlier leader crosses it (except a `far` tag: the
// last resort, stacked below everything, whose leader may cross).
// items: [{ id, x, y, r, num, name, sub }] (x, y = point centre, r = ring radius).
// Returns { id: { x, y, w, h, line1, sub, lead: [[x, y], [x, y]] } }.
export const PR = 13; // point keep-out radius
// Advances measured from the font files (Rajdhani Bold 11; Share Tech Mono 8.5 = 4.59 per char,
// its missing ▲●○◆◇ fall back to a wider font), plus 5% slack.
const RAJ = { I: 2.94, 1: 3.67, " ": 2.42, "-": 3.43, ".": 2.24, _: 4.09, M: 7.99, W: 8.88, E: 5.27, F: 4.95, L: 4.94, T: 4.87, 7: 4.74, "\u2026": 6.68 };
const textW = (str) => [...str].reduce((w, c) => w + (RAJ[c] ?? 6.43), 0) * 1.05;
const MONO_CH = (ch) => (ch.charCodeAt(0) > 0x2000 && ch !== "\u2026" ? 7 : 4.59) * 1.05;
const over = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const hitsPoint = (box, [cx, cy], r = PR) => {
  const nx = Math.max(box.x, Math.min(cx, box.x + box.w)), ny = Math.max(box.y, Math.min(cy, box.y + box.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r;
};
// Does segment a-b pass through the rectangle's inside? (Liang-Barsky, rect shrunk 0.5px so touching is fine.)
export function crosses([ax, ay], [bx, by], { x, y, w, h }) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - (x + 0.5)], [dx, x + w - 0.5 - ax], [-dy, ay - (y + 0.5)], [dy, y + h - 0.5 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}
// Leader: from the tag's corner nearest the point to the point's ring.
export function leader(box, cx, cy, r) {
  const [qx, qy] = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .reduce((m, c) => ((c[0] - cx) ** 2 + (c[1] - cy) ** 2 < (m[0] - cx) ** 2 + (m[1] - cy) ** 2 ? c : m));
  const d = Math.hypot(qx - cx, qy - cy) || 1;
  return [[qx, qy], [Math.round((cx + ((qx - cx) / d) * r) * 10) / 10, Math.round((cy + ((qy - cy) / d) * r) * 10) / 10]];
}
const NEAR = [];
for (let dy = -72; dy <= 72; dy += 3) for (let dx = -90; dx <= 90; dx += 3) NEAR.push([dx, dy]);
NEAR.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2 || a[1] - b[1] || a[0] - b[0]);
const DIRS = [[1, -1], [1, 0], [1, 1], [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1]]; // NE E SE NW W SW N S
export function labels(items, width) {
  const out = {}, placed = [];
  const pts = items.map((i) => [i.x, i.y]);
  const sorted = [...items].sort((a, b) => String(a.num).localeCompare(String(b.num)) || String(a.id).localeCompare(String(b.id)));
  const ok = (box, lead) => box.x >= 0 && box.y >= 0 && box.x + box.w <= width
    && !placed.some((p) => over(box, p) || crosses(...lead, p) || (!p.far && crosses(...p.lead, box)))
    && !pts.some((p) => hitsPoint(box, p));
  for (const it of sorted) {
    const full = String(it.name).toUpperCase(), sub = String(it.sub ?? "");
    // Extra 10px lines under the details (a repo's worktree spaces).
    const lines = [sub, ...(it.more ?? [])].filter(Boolean);
    const h = 16 + 10 * lines.length, w2 = Math.max(0, ...lines.map((l) => [...l].reduce((s, c) => s + MONO_CH(c), 0)));
    const make = (n) => {
      const name = n === full.length ? full : full.slice(0, n - 1) + "\u2026";
      const line1 = `${it.num} ${name}`;
      return { line1, w: Math.ceil(Math.max(textW(line1), w2)) + 8, h };
    };
    let got = null;
    for (let n = full.length; n >= Math.min(4, full.length) && !got; n--) {
      const t = make(n);
      for (const d of [14, 20, 26, 30]) {
        for (const [ux, uy] of DIRS) {
          const k = ux && uy ? Math.SQRT1_2 : 1, ax = it.x + ux * d * k, ay = it.y + uy * d * k;
          const box = { x: Math.round(ux > 0 ? ax : ux < 0 ? ax - t.w : ax - t.w / 2), y: Math.round(uy > 0 ? ay : uy < 0 ? ay - h : ay - h / 2), w: t.w, h };
          const lead = leader(box, it.x, it.y, it.r);
          if (ok(box, lead)) { got = { ...box, line1: t.line1, sub, more: it.more ?? [], lead }; break; }
        }
        if (got) break;
      }
    }
    if (!got) {
      // Then the shortest tag at the free spot nearest the point (3px lattice, nearest first).
      const t = make(Math.min(4, full.length));
      for (const [dx, dy] of NEAR) {
        const box = { x: Math.round(it.x + 14 + dx), y: Math.round(it.y - h / 2 + dy), w: t.w, h }, lead = leader(box, it.x, it.y, it.r);
        if (ok(box, lead)) { got = { ...box, line1: t.line1, sub, more: it.more ?? [], lead }; break; }
      }
      if (!got) {
        // Last resort: below every tag and point (never overlaps); only its leader may cross a tag.
        const y = Math.ceil(Math.max(...placed.map((p) => p.y + p.h), ...pts.map((p) => p[1] + PR))) + 4;
        const box = { x: Math.max(0, Math.min(width - t.w, Math.round(it.x - t.w / 2))), y, w: t.w, h };
        got = { ...box, line1: t.line1, sub, more: it.more ?? [], lead: leader(box, it.x, it.y, it.r), far: true };
      }
    }
    out[it.id] = got;
    placed.push(got);
  }
  return out;
}

// Agent ring: one arc per agent (max 12) with ~2px gaps, starting at 12 o'clock, as short
// polylines around (cx, cy). Returns [{ status, pts: [[x, y], ...] }] in the given order.
export function ring(statuses, r, cx = 0, cy = 0) {
  const n = Math.min(12, statuses.length);
  if (!n) return [];
  const gap = 2 / r, span = (Math.PI * 2) / n - gap;
  return statuses.slice(0, n).map((status, i) => {
    const a0 = -Math.PI / 2 + i * (span + gap) + gap / 2, k = Math.max(2, Math.ceil(span / 0.26));
    return { status, pts: Array.from({ length: k + 1 }, (_, j) => { const a = a0 + (j / k) * span; return [Math.round((cx + Math.cos(a) * r) * 100) / 100, Math.round((cy + Math.sin(a) * r) * 100) / 100]; }) };
  });
}

// ── One region's whole map, used by main.js and by the check (so both use the same widths).
// `avail` = the region's real drawable width. Each point gets a 44px cell (so neighbours stay >= 48px
// apart and tags fit between them); the 28px hit area sits in its middle. Inset so the coast and the
// suburbs (out to 50px) have room. points: [{ id, x, y }] = cell centres.
export const MAP = { gap: 4, unit: 90, rowH: [44, 50], rowGap: 24, size: 44, MX: 30, MY: 30, M: 30 };
export function region(input, avail, seed) {
  const { MX, MY, M, ...opts } = MAP;
  const boxes = districts(input, Math.max(40, avail - 2 * MX), opts).map((b) => ({ ...b, x: b.x + MX, y: b.y + MY }));
  const geo = terrain(boxes, avail, seed, M);
  const lines = roads(boxes, avail, geo.height);
  const points = boxes.map((b) => ({ id: b.id, x: b.x + b.w / 2, y: b.y + b.h / 2 }));
  return { boxes, points, ...geo, lines, bridges: bridges(lines, geo.river) };
}

// Worktree spaces → their repo's space. A worktree space's folder is Herdr's checkout root
// `…/.herdr/worktrees/<repo>/<branch>`; its parent is another space (same machine) whose folder has a
// `<repo>` segment and isn't a worktree. ponytail: name match only, so worktrees made elsewhere stay
// their own district, and two repos with the same folder name pick the first. list: [{ id, place, machine }].
const WT = /\/\.herdr\/worktrees\/([^/]+)\/[^/]+/;
export function worktreeParents(list) {
  const out = {};
  for (const k of list) {
    const m = String(k.place ?? "").match(WT);
    if (!m) continue;
    // Closest to the repo root wins: `…/herdr-gallery` over `…/herdr-gallery/mods/x` (a space opened in a subfolder).
    let best = null, depth = Infinity;
    for (const s of list) {
      if (s.id === k.id || (s.machine ?? null) !== (k.machine ?? null) || WT.test(s.place ?? "")) continue;
      const seg = String(s.place ?? "").split("/"), at = seg.lastIndexOf(m[1]);
      if (at >= 0 && seg.length - at < depth) { best = s; depth = seg.length - at; }
    }
    if (best) out[k.id] = best.id;
  }
  return out;
}
