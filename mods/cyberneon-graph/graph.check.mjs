// node mods/cyberneon-graph/graph.check.mjs
import assert from "node:assert/strict";
import { lanes, parseLog, parseRefs, parseShow, ago } from "./graph.js";

const C = (spec) => spec.split(" ").map((s) => { const [hash, ps = ""] = s.split(":"); return { hash, parents: ps ? ps.split(",") : [] }; });
const width = (rows) => Math.max(...rows.flatMap((r) => [r.lane, ...r.edges.flatMap((e) => [e.fromLane, e.toLane])])) + 1;

// Every row: one commit, its lane carries no pass line from another commit, edges land on lanes the next row has.
function sane(commits, rows) {
  assert.equal(rows.length, commits.length);
  rows.forEach((r, i) => {
    const from = r.edges.map((e) => e.fromLane);
    assert.equal(new Set(r.edges.map((e) => `${e.fromLane}>${e.toLane}`)).size, r.edges.length, `row ${i} dup edge`);
    if (i > 0) {
      // Lines entering this row: the ones ending on this commit's lane end here; the others pass on.
      const into = rows[i - 1].edges.map((e) => e.toLane);
      const passing = into.filter((l) => l !== r.lane);
      for (const l of passing) assert.ok(from.includes(l), `row ${i}: lane ${l} dropped`);
    }
    // No two commits in one row share a lane: other lanes passing through never sit on the commit's lane.
    assert.ok(r.edges.filter((e) => e.fromLane === r.lane && e.kind === "pass" && e.toLane !== r.lane).length === 0);
  });
}

// linear history = 1 lane
{
  const c = C("d:c c:b b:a a");
  const r = lanes(c); sane(c, r);
  assert.equal(width(r), 1);
  assert.ok(r.every((x) => x.lane === 0));
  assert.equal(r[3].edges.length, 0);
}
// a simple merge = 2 lanes that rejoin
{
  const c = C("m:a,b b:a a");
  const r = lanes(c); sane(c, r);
  assert.equal(width(r), 2);
  assert.ok(r[0].merge);
  assert.deepEqual(r[0].edges.find((e) => e.kind === "merge"), { fromLane: 0, toLane: 1, kind: "merge", color: 1 });
  assert.equal(r[1].lane, 1);
  assert.deepEqual(r[1].edges.find((e) => e.fromLane === 1), { fromLane: 1, toLane: 0, kind: "join", color: 1 });
  assert.equal(r[2].lane, 0);
}
// two branches off main
{
  const c = C("x:a y:b m:b b:a a");
  const r = lanes(c); sane(c, r);
  assert.deepEqual(r.map((x) => x.lane), [0, 1, 2, 1, 0]);
  assert.equal(new Set([r[0].color, r[1].color, r[2].color]).size, 3);
  assert.equal(r[4].edges.length, 0);
  // free lanes are reused: after everything converges a new tip takes lane 0 again
  const r2 = lanes(C("p:q q z:w w"));
  assert.deepEqual(r2.map((x) => x.lane), [0, 0, 0, 0]);
}
// an octopus merge
{
  const c = C("o:a,b,c b:a c:a a");
  const r = lanes(c); sane(c, r);
  assert.equal(r[0].edges.filter((e) => e.kind === "merge").length, 2);
  assert.equal(width(r), 3);
  assert.equal(r[3].lane, 0);
}
// determinism
{
  const c = C("o:a,b,c x:b b:a c:a a");
  assert.deepEqual(lanes(c), lanes(structuredClone(c)));
}
// parsing
{
  const refs = parseRefs("HEAD -> refs/heads/main, tag: refs/tags/v0.1.1, refs/remotes/origin/main, refs/remotes/origin/HEAD, refs/heads/dev");
  assert.deepEqual(refs, [{ kind: "head" }, { kind: "branch", name: "main", current: true }, { kind: "tag", name: "v0.1.1" },
    { kind: "remote", name: "origin/main" }, { kind: "branch", name: "dev" }]);
  const log = parseLog("aa\x1fbb cc\x1f\x1fhi\x1fAnn Lee\x1f100\x1e\nbb\x1f\x1ftag: refs/tags/v1\x1fx\x1fB\x1f50\x1e\n");
  assert.equal(log.length, 2);
  assert.deepEqual(log[0].parents, ["bb", "cc"]);
  assert.equal(log[1].refs[0].name, "v1");
  assert.equal(log[0].time, 100000);
  const s = parseShow("h\nAnn\na@b\n2026-01-01 10:00:00 +0800\np1 p2\n\n a | 3 ++-\n 2 files changed, 10 insertions(+), 1 deletion(-)\n");
  assert.deepEqual({ ...s }, { hash: "h", author: "Ann", date: "2026-01-01 10:00:00 +0800", parents: ["p1", "p2"], files: 2, add: 10, del: 1 });
  assert.equal(ago(3 * 86400_000), "3d");
}
console.log("graph.check ok");
