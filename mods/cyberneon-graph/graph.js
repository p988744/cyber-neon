// Pure git-graph helpers (no herdr imports, so node can check them: graph.check.mjs).

export const FS = "\x1f", RS = "\x1e";

// `git log --format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ct%x1e --decorate=full` → commits.
export function parseLog(out) {
  return out.split(RS).map((r) => r.replace(/^\n/, "")).filter((r) => r.trim()).map((r) => {
    const [hash, parents, deco, subject, author, ct] = r.split(FS);
    return { hash, parents: parents ? parents.split(" ") : [], refs: parseRefs(deco ?? ""), subject: subject ?? "", author: author ?? "", time: Number(ct) * 1000 };
  });
}

// `HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main` → typed refs.
export function parseRefs(deco) {
  const out = [];
  for (let part of deco.split(", ").filter(Boolean)) {
    if (part === "HEAD") { out.push({ kind: "head" }); continue; }
    if (part.startsWith("HEAD -> ")) { out.push({ kind: "head" }); part = part.slice(8); out.push({ kind: "branch", name: part.replace(/^refs\/heads\//, ""), current: true }); continue; }
    if (part.startsWith("tag: ")) { out.push({ kind: "tag", name: part.slice(5).replace(/^refs\/tags\//, "") }); continue; }
    if (part.startsWith("refs/heads/")) out.push({ kind: "branch", name: part.slice(11) });
    else if (part.startsWith("refs/remotes/")) { if (!part.endsWith("/HEAD")) out.push({ kind: "remote", name: part.slice(13) }); }
    else if (part.startsWith("refs/stash")) continue;
    else out.push({ kind: "branch", name: part });
  }
  return out;
}

// The usual lane walk over commits in topo order. Each row: the commit's lane and color, plus the
// edges from this row's centre to the next row's centre ({fromLane, toLane, kind, color}).
// kind: "pass" (straight), "join" (a lane converging into the next commit), "merge" (a merge commit's
// line out to another parent's lane, new or existing). Colors are indices, kept per lane.
export function lanes(commits) {
  const slot = []; // lane → expected hash, or null when free
  const color = []; // lane → color index
  let nextColor = 0;
  const take = (hash) => {
    let i = slot.indexOf(null);
    if (i < 0) i = slot.length;
    slot[i] = hash; color[i] = nextColor++;
    return i;
  };
  const rows = [];
  for (let r = 0; r < commits.length; r++) {
    const c = commits[r];
    let lane = slot.indexOf(c.hash);
    if (lane < 0) lane = take(c.hash);
    for (let k = 0; k < slot.length; k++) if (k !== lane && slot[k] === c.hash) slot[k] = null; // converged
    const out = []; // [fromLane, hash, kind]
    const [first, ...rest] = c.parents;
    slot[lane] = first ?? null;
    for (const p of rest) {
      const at = slot.indexOf(p);
      out.push([lane, p, "merge", at >= 0 ? at : take(p)]);
    }
    if (first) out.push([lane, first, "pass", lane]);
    for (let k = 0; k < slot.length; k++) if (k !== lane && slot[k] != null) out.push([k, slot[k], "pass", k]);
    // Lanes heading for the next commit converge into the lane it will take (the lowest one).
    const next = commits[r + 1]?.hash;
    const nextLane = next ? slot.indexOf(next) : -1;
    const edges = out.map(([from, hash, kind, to]) => {
      if (hash === next && nextLane >= 0 && to !== nextLane) return { fromLane: from, toLane: nextLane, kind: kind === "merge" ? "merge" : "join", color: color[to] };
      return { fromLane: from, toLane: to, kind, color: color[to] };
    });
    // De-dupe (a merge into an existing lane also has that lane's own pass line).
    const seen = new Set();
    rows.push({ hash: c.hash, lane, color: color[lane], merge: c.parents.length > 1,
      edges: edges.filter((e) => { const k = `${e.fromLane}>${e.toLane}`; if (seen.has(k)) return false; seen.add(k); return true; }) });
    while (slot.length && slot[slot.length - 1] == null) slot.pop();
  }
  return rows;
}

export function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
  return `${Math.floor(s / 86400 / 365)}y`;
}

// `git show --stat --format=%H%n%an%n%ae%n%ci%n%P -1` → details (the email is read, never shown).
export function parseShow(out) {
  const lines = out.split("\n");
  const [hash, author, , date, parents] = lines;
  const sum = [...lines].reverse().find((l) => /\d+ files? changed/.test(l)) ?? "";
  const n = (re) => Number(sum.match(re)?.[1] ?? 0);
  return { hash, author, date, parents: parents ? parents.split(" ").filter(Boolean) : [],
    files: n(/(\d+) files? changed/), add: n(/(\d+) insertions?/), del: n(/(\d+) deletions?/) };
}
