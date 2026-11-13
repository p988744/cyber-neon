// Run: node mods/cyberneon-spaces/districts.check.mjs
import assert from "node:assert/strict";
import { districts, code } from "./districts.js";

const names = ["api-docs", "mywork", "atlas-site", "atlasGpu", "deepnet", "lab-notes", "herdr-gallery",
  "app-core", "Zebra", "zz", "alpha", "ab", "aa", "a", "9lives", "_x", "Mmm", "mzz", "big-one", "bee"];
const spaces = names.map((name, i) => ({ id: `s${i}`, name, tabs: (i * 5) % 7 }));
for (const [width, opts] of [[232, undefined], [352, { gap: 6, unit: 80, rowH: [58, 74] }], [90, undefined]]) {
  const d = districts(spaces, width, opts);
  assert.equal(d.length, spaces.length);
  for (const a of d) {
    assert.ok(a.x >= 0 && a.y >= 0 && a.w > 0 && a.x + a.w <= width, `inside width ${width}: ${JSON.stringify(a)}`);
    for (const b of d) if (a !== b)
      assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `overlap ${a.id} ${b.id}`);
  }
  assert.deepEqual(districts([...structuredClone(spaces)].reverse(), width, opts), d, "same input (any order), same output");
}
// A sits above or left of Z (no collision involved).
const [a, z] = districts([{ id: "z", name: "zulu" }, { id: "a", name: "alpha" }], 232).sort((p, q) => p.id.localeCompare(q.id));
assert.ok(a.y < z.y || (a.y === z.y && a.x < z.x), "A before Z");
assert.deepEqual(districts([], 200), []);
assert.equal(code("atlas"), "ATLS");
assert.equal(code("herdr-gallery"), "HGAL");
console.log("districts: ok");

// Roads stay inside the region and are deterministic.
import { roads, inside } from "./districts.js";
const boxes = districts(spaces, 324);
const rd = roads(boxes, 324, 300);
assert.ok(rd.length > 0 && rd.every((l) => l.every(([x, y]) => x >= 0 && x <= 324 && y >= 0 && y <= 300)));
assert.deepEqual(roads(boxes, 324, 300), rd);
console.log("roads: ok");

// v4.3 points + tags, at the sidebar's real widths (458 live, 340 in the layout file: minus 2*8 padding, 6 scrollbar).
import { region, labels, crosses, hitsPoint, ring } from "./districts.js";
const sub = (i) => ["▲1 ●2 ○3 · main · ◆2◇5", "●1 · feature/very-l…", "", "○2"][i % 4];
let far = 0;
for (const avail of [436, 318, 250, 138]) {
  for (const set of [spaces, spaces.slice(0, 9), spaces.slice(0, 2), spaces.slice(5, 6)]) {
    const g = region(set, avail, "This computer");
    for (const p of g.points) {
      assert.ok(inside([p.x, p.y], g.land), `point ${p.id} on land`);
      if (g.river) {
        const [lo, hi] = [g.river.lo - 14, g.river.hi + 14]; // the ring stays dry too
        assert.ok(!((g.river.vertical ? p.x : p.y) > lo && (g.river.vertical ? p.x : p.y) < hi), `point ${p.id} off the river`);
      }
      assert.ok(p.y + 22 <= g.height, "region height covers points");
    }
    assert.ok(g.land.length >= 24 && g.land.length <= 90, `coast vertices ${g.land.length}`);
    assert.deepEqual(region(structuredClone(set), avail, "This computer"), g, "terrain determinism");
    const items = g.points.map((p, i) => ({ ...p, r: i === 0 ? 12 : 9, num: String(i + 1).padStart(2, "0"), name: set.find((s) => s.id === p.id).name, sub: sub(i) }));
    const lb = labels(items, avail);
    assert.deepEqual(labels(structuredClone(items).reverse(), avail), lb, "label determinism");
    const ls = Object.entries(lb);
    for (const [id, a] of ls) {
      far += a.far ? 1 : 0;
      if (set.length <= 9 && avail >= 250) assert.ok(!a.far, `${a.line1} fell back below the map at ${avail}`);
      assert.ok(a.x >= 0 && a.x + a.w <= avail && a.y >= 0, `tag inside: ${a.line1}`);
      for (const p of g.points) assert.ok(!hitsPoint(a, [p.x, p.y]), `tag ${a.line1} covers point ${p.id}`);
      for (const [oid, b] of ls) if (oid !== id) {
        assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `tags overlap ${a.line1} ${b.line1}`);
        if (!a.far) assert.ok(!crosses(...a.lead, b), `leader of ${a.line1} crosses ${b.line1}`);
      }
    }
  }
}
assert.ok(crosses([0, 5], [20, 5], { x: 5, y: 0, w: 5, h: 10 }) && !crosses([0, 0], [4, 4], { x: 5, y: 0, w: 5, h: 10 }), "crosses()");
const rg = ring(["blocked", "working", "idle"], 9);
assert.equal(rg.length, 3);
assert.ok(rg.every((a) => a.pts.every(([x, y]) => Math.abs(Math.hypot(x, y) - 9) < 0.05)), "arcs on the ring");
assert.equal(ring(Array(20).fill("idle"), 9).length, 12, "max 12 arcs");
const r1 = region(spaces, 436, "This computer");
console.log(`points/tags: ok (${far} stress-case tags stacked below, river ${r1.river ? (r1.river.vertical ? "vertical" : "horizontal") : "no"}, coast ${r1.land.length} pts, ${r1.suburbs.length} suburb blocks)`);
