// Workspace spaces as points on a city map: one region per machine, one marker per space with a
// tag carrying its details, and a numbered legend. Click to switch, right-click for its menu.
// The narrow rail keeps numbered cells.

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, Popup, ScrollHandle } from "gpui-base";
import { spaces, machines, panes, run, openOverlay, theme, layout, agents, terminals, shared, setShared, exec } from "herdr";
import { hash, region, labels, ring, worktreeParents } from "./districts.js";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;
const RAIL_CELL = 32;
const railCell = (el) => h_flex().flex_none().justify_center().child(el);

// Cyberneon look (matches cyberneon-agents): caps section labels with a 1px rule
// and a 24px accent lead, Share Tech Mono for data.
const MONO = "Share Tech Mono";
const LABEL = "Chakra Petch";
const rule = (t) => h_flex().h(1).w_full().flex_none().child(div().w(24).h(1).flex_none().bg(t.accent)).child(div().flex_1().h(1).bg(t.border));
const label = (t, text) => div().truncate().font_family(LABEL).font_semibold().text_size(11).text_color(t.accent).child(text.toUpperCase());

// Quest markers: open issues/milestones per GitHub repo, read-only through `gh` (one GraphQL
// query, no writes). Pattern copied from cyberneon-jobs (mods can't import each other).
const QTTL = 600_000, QLOCK_TTL = 60_000;
const QLOCK = "cyberneon.map.quests.fetching";
const questKey = (repo) => `cyberneon.map.quests.${repo}`;
const QUERY = "query($o:String!,$n:String!){repository(owner:$o,name:$n){issues(states:OPEN){totalCount} milestones(states:OPEN){totalCount}}}";
const parseRemote = (url) => url.trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/)?.[1] ?? null;
function reason(r) {
  const s = `${r.stderr}\n${r.stdout}`.toLowerCase();
  if (/auth login|not logged|authentication/.test(s)) return "gh not logged in";
  if (/rate limit/.test(s)) return "rate limited";
  return (r.stderr || r.stdout).trim().split("\n")[0].slice(0, 48) || `gh exit ${r.code}`;
}
async function gh(args, cwd, on) {
  let r;
  try { r = await exec("gh", args, { cwd, on, timeout: 20_000 }); }
  catch (e) { throw new Error(/no such|not found|enoent/i.test(String(e)) ? "gh not installed" : String(e).slice(0, 48)); }
  if (r.code !== 0) throw new Error(reason(r));
  return JSON.parse(r.stdout || "null");
}
const DIAMOND = PathBuilder.fill().add_polygon([[3.5, 0], [7, 3.5], [3.5, 7], [0, 3.5]], true).build();

// Map look: sea, land, points. Point box: 40px drawing area around the 28px hit area.
const SEA = "#0a1220";
const LAND = "#151822"; // a shade lighter than canvas (#0a0b0f), clearly apart from the sea
const HIT = 28, ART = 40;
const circle = (r) => { let p = PathBuilder.stroke(1).move_to(ART / 2 + r, ART / 2); for (let i = 1; i <= 48; i++) { const a = (i / 48) * Math.PI * 2; p = p.line_to(ART / 2 + Math.cos(a) * r, ART / 2 + Math.sin(a) * r); } return p.build(); };
const RING9 = circle(9), RING12 = circle(12);
const stateColor = (t, st) => (st === "blocked" ? t.blocked : st === "done" ? t.done : st === "working" ? t.working : t.idle ?? t.muted);
const norm = (st) => (st === "blocked" || st === "done" || st === "working" ? st : "idle");
// Hover card helpers (state words and chips as in cyberneon-agents).
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const WORD = { blocked: "INPUT REQ", done: "COMPLETE", working: "EXEC", idle: "STANDBY" };
const hex3 = (id) => "0x" + (hash(String(id)) & 0xfff).toString(16).toUpperCase().padStart(3, "0");
function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}
function chip(t, status, anim) {
  const c = div().flex_none().h(14).px(5).flex().items_center().font_family(LABEL).font_semibold().text_size(9.5);
  if (status === "blocked") return c.bg(t.blocked).text_color(t.solid_foreground ?? t.canvas).when(anim, (el) => el.loop("opacity", { from: -6, to: 7, period: 900, easing: "linear" })).child(WORD.blocked);
  if (status === "done") return c.bg(t.done).text_color(t.solid_foreground ?? t.canvas).child(WORD.done);
  if (status === "working") return c.text_color(t.working).child(WORD.working);
  return c.gap(4).text_color(t.dim).child(div().size(6).border(1).border_color(t.idle ?? t.dim)).child(WORD.idle);
}

// A space speaks up only when something in it needs you.
export function glyph(status) {
  return status === "blocked" || status === "done" ? "●" : "·";
}

export function tone(t, status) {
  return t[status] ?? t.unknown;
}

export default class Spaces extends View {
  init(_props, cx) {
    this.acx = cx; // hover-card timers need init's AsyncContext
    this.card = null; // space id whose hover card is open
    // Keeps the map's scroll position across re-renders (hovering a point re-rendered it back to the top).
    this.mapScroll = ScrollHandle.new();
    this.size = {}; // map box size, from on_size_change
    this.repos = {}; // JSON [machine, folder] -> "owner/name" | null (git remote, read once)
    // ponytail: one slow timer; each repo is still fetched at most every 10 min (QTTL).
    cx.timer.every(60_000, (cx) => this.quests(cx));
    this.quests(cx);
    this.building = new Map(); // key -> job (terrain build / label placement) for pump()
    this.memo = {}; // machine -> { key, points, land, roads, plates }: geometry + built paths
  }

  repoOf(s) {
    return this.repos[JSON.stringify([s.machine ?? null, s.folder ?? null])] ?? null;
  }

  // Read-only: `git remote get-url origin` once per space folder, then one gh GraphQL call per
  // stale repo, one at a time across copies (shared lock, ignored after 60s). Errors are cached.
  quests(cx) {
    if (this.questing) return;
    this.questing = true;
    cx.spawn(async (cx) => {
      try {
        const where = {}; // repo -> { folder, on }
        for (const s of spaces()) {
          if (!s.folder) continue;
          const k = JSON.stringify([s.machine ?? null, s.folder]);
          if (!(k in this.repos)) {
            const r = await exec("git", ["-C", s.folder, "remote", "get-url", "origin"], { on: s.machine ?? null, timeout: 5000 }).catch(() => ({ code: 1, stdout: "" }));
            this.repos[k] = r.code === 0 ? parseRemote(r.stdout) : null;
          }
          if (this.repos[k]) where[this.repos[k]] ??= { folder: s.folder, on: s.machine ?? null };
        }
        for (const [repo, { folder, on }] of Object.entries(where)) {
          const cache = shared(questKey(repo));
          if (cache && Date.now() - cache.at < QTTL) continue; // errors too: no retry before 10 min
          const lock = shared(QLOCK);
          if (lock && Date.now() - lock.at < QLOCK_TTL) break;
          setShared(QLOCK, { repo, at: Date.now() });
          try {
            const [o, n] = repo.split("/");
            const d = (await gh(["api", "graphql", "-f", `query=${QUERY}`, "-f", `o=${o}`, "-f", `n=${n}`], folder, on))?.data?.repository;
            if (!d) throw new Error("repo not found");
            setShared(questKey(repo), { at: Date.now(), issues: d.issues.totalCount, milestones: d.milestones.totalCount });
          } catch (e) {
            setShared(questKey(repo), { at: Date.now(), error: e.message || String(e) });
          } finally {
            setShared(QLOCK, null);
          }
        }
      } finally {
        this.questing = false;
        cx.notify();
      }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "cyberneon-menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  compact(w, i, t) {
    return railCell(h_flex()
      .id(`space-${w.id}`)
      .relative()
      .w(RAIL_CELL)
      .h(26)
      .rounded(0)
      .justify_center()
      .items_center()
      .border_l(3)
      .border_color(w.active ? t.accent : t.border)
      .when(w.active, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .child(div().font_family(MONO).text_color(w.active ? t.foreground : t.muted).child(String(i + 1)))
      .child(div().absolute().right(5).text_color(tone(t, w.status)).child(glyph(w.status))));
  }

  // ── MAP: spaces as points on generated terrain, one island per machine. The sidebar's only view.
  map(t) {
    const anim = shared("cyberneon.animations") !== false;
    const pad = 8;
    // The real drawable width: the measured block (or the layout's sidebar size before the first
    // measure), minus padding and room for the scrollbar. Same number goes to region() and the check.
    const side = find(layout(), "sidebar")?.size?.px;
    const width = Math.min(this.size.width ?? side ?? 340, side ?? Infinity);
    const avail = Math.max(60, Math.floor(width - pad * 2 - 6));
    const sp = spaces(), ag = agents(), ps = panes(), ms = machines();
    const remote = [...new Set([...sp.map((s) => s.machine).filter(Boolean), ...ms.map((m) => m.name).filter(Boolean)])].sort();
    const W = globalThis.window;
    const at = (el) => el.absolute().top(0).left(0).size_full();
    const byName = (a, b) => String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id));
    let num = 0; // legend numbers run A-Z per region, continuing across machines
    // Worktree spaces share their repo's point instead of getting a district (the default sidebar nests them).
    const place = (s) => { const tb = new Set((s.tabs ?? []).map((c) => c.id)); return ps.find((p) => tb.has(p.tab) && p.cwd)?.cwd || s.folder || ""; };
    const parentOf = worktreeParents(sp.map((s) => ({ id: s.id, place: place(s), machine: s.machine })));
    const regions = [null, ...remote].map((m, n) => {
      const all = sp.filter((s) => (s.machine ?? null) === m).sort(byName);
      const kidsOf = (id) => all.filter((k) => parentOf[k.id] === id);
      // Legend order: each repo space, then its worktrees (06, 06a, 06b).
      const mine = all.filter((s) => !parentOf[s.id]).flatMap((s) => [s, ...kidsOf(s.id)]);
      const nums = {};
      for (const s of mine) nums[s.id] = parentOf[s.id] ? nums[parentOf[s.id]] + "abcdefghijklmnopqrstuvwxyz"[kidsOf(parentOf[s.id]).indexOf(s)] : String(++num).padStart(2, "0");
      const off = m !== null && ms.find((k) => k.name === m)?.layout !== "ready";
      const geo = this.geometry(m, mine.filter((s) => !parentOf[s.id]), avail) ?? { points: [], height: 24, key: "pending" };
      const head = v_flex().pt(10).pb(2).flex_none().gap(3)
        .child(h_flex().h(18).gap(6).items_center()
          .child(div().flex_none().font_family(MONO).text_size(9).text_color(t.dim).child(`//${String(n + 1).padStart(2, "0")}`))
          .child(label(t, m ?? "This computer")))
        .child(rule(t));
      const info = Object.fromEntries(mine.map((s) => {
        const repo = this.repoOf(s), q = repo ? shared(questKey(repo)) : null;
        const list = ag.filter((a) => a.space === s.id).sort((a, b) => (RANK[norm(b.status)] ?? 0) - (RANK[norm(a.status)] ?? 0) || a.seq - b.seq);
        const tabs = new Set((s.tabs ?? []).map((c) => c.id));
        const branch = ps.find((p) => tabs.has(p.tab) && p.branch)?.branch;
        return [s.id, { s, agents: list, quest: q && !q.error && (q.milestones || q.issues) ? q : null, branch }];
      }));
      // A repo's point carries its worktree spaces: their agents join its ring and hover card, it's active when they are.
      const merged = (id) => {
        const kids = kidsOf(id).map((k) => info[k.id]), own = info[id];
        return kids.length ? { ...own, s: { ...own.s, active: own.s.active || kids.some((k) => k.s.active) }, agents: [...own.agents, ...kids.flatMap((k) => k.agents)], kids } : { ...own, kids: [] };
      };
      // Tags, rings and leaders are placed and built in a queued job (render has a time budget);
      // the last result is drawn meanwhile.
      const items = geo.points.map((p) => {
        const { s, agents: a, quest, branch, kids } = merged(p.id);
        const count = (st) => a.filter((x) => norm(x.status) === st).length;
        const sub = [[["▲", count("blocked")], ["●", count("working")], ["○", count("idle")]].filter(([, c]) => c).map(([g, c]) => g + c).join(" "),
          branch ? (branch.length > 12 ? branch.slice(0, 11) + "…" : branch) : "",
          quest ? `◆${quest.milestones}◇${quest.issues}` : ""].filter(Boolean).join(" · ");
        // Its worktree spaces on one short line: `↳ M1 ●1 · #4 ○1` (milestone-/issue- branches shortened), max 3 then +n.
        const short = (b) => { const m = String(b).match(/^(milestone|issue)-(\d+)/); return m ? (m[1] === "milestone" ? `M${m[2]}` : `#${m[2]}`) : String(b).slice(0, 10); };
        const wts = kids.map((k) => [short(k.branch ?? k.s.name), [["▲", "blocked"], ["●", "working"], ["○", "idle"]]
          .map(([g, st]) => [g, k.agents.filter((x) => norm(x.status) === st).length]).filter(([, c]) => c).map(([g, c]) => g + c).join("")].filter(Boolean).join(" "));
        const more = wts.length ? [`↳ ${wts.slice(0, 3).join(" · ")}${wts.length > 3 ? ` +${wts.length - 3}` : ""}`] : [];
        return { id: p.id, x: p.x, y: p.y, r: s.active ? 12 : 9, num: nums[p.id], name: s.name, sub, more, states: a.map((x) => norm(x.status)), blocked: count("blocked") > 0, active: Boolean(s.active) };
      });
      const lkey = JSON.stringify([geo.key, items]);
      if (geo.plates?.key !== lkey && !this.building.has(lkey)) {
        this.building.set(lkey, () => { geo.plates = this.tags(items, avail, lkey); });
        this.pump();
      }
      const tg = geo.plates ?? { at: {}, rings: {} };
      const bottom = Math.max(geo.height, ...Object.values(tg.at).map((p) => p.y + p.h + 6));
      return v_flex().flex_none().when(off, (el) => el.opacity(0.4))
        .when(n > 0, (el) => el.mt(4).child(W.paint_path(PathBuilder.stroke(1).dash_array([4, 3]).move_to(0, 0).line_to("100%", 0).build(), t.dim).h(1).w_full()))
        .child(head)
        .child(this.legend(t, mine, nums, avail))
        .child(div().relative().w_full().h(bottom).flex_none()
          .when(!mine.length, (el) => el.child(div().pt(6).font_family(MONO).text_size(9).text_color(t.dim).child("NO SPACES")))
          .when(Boolean(geo.land), (el) => el
            .child(at(W.paint_path(geo.coast6, Background.solid(t.working).opacity(0.06))))
            .child(at(W.paint_path(geo.landFill, LAND)))
            .child(at(W.paint_path(geo.coast1, Background.solid(t.working).opacity(0.3))))
            .when(Boolean(geo.suburbs), (e) => e.child(at(W.paint_path(geo.suburbs, Background.solid(t.accent).opacity(0.18)))))
            .when(Boolean(geo.islets), (e) => e.child(at(W.paint_path(geo.islets, LAND))))
            .when(Boolean(geo.river), (e) => e.child(at(W.paint_path(geo.banks, Background.solid(t.working).opacity(0.25)))).child(at(W.paint_path(geo.river, SEA))))
            .when(Boolean(geo.roads), (e) => e.child(at(W.paint_path(geo.roads, Background.solid(t.working).opacity(0.6)))))
            .when(Boolean(geo.bridges), (e) => e.child(at(W.paint_path(geo.bridges, Background.solid(t.working).opacity(0.8))))))
          .when(Boolean(tg.leaders), (el) => el.child(at(W.paint_path(tg.leaders, t.solid))))
          .children(geo.points.filter((p) => info[p.id]).map((p) => this.point(t, merged(p.id), p, tg.rings[p.id], anim)))
          .children(geo.points.filter((p) => info[p.id]).map((p) => { const g = merged(p.id); return this.tag(t, g.s, tg.at[p.id], g.agents.some((a) => a.status === "blocked"), g.kids); })));
    });
    return div().relative().flex_1().min_h(0).bg(SEA)
      .on_size_change((size, cx) => {
        if (Math.round(size.width) !== this.size.width) { this.size = { width: Math.round(size.width) }; cx.notify(); }
      })
      .child(v_flex().id("map-scroll").absolute().top(0).left(0).size_full().px(pad).pb(24).overflow_y_scrollbar().track_scroll(this.mapScroll)
        .when(!sp.length, (el) => el.child(div().pt(16).font_family(MONO).text_size(9).text_color(t.dim).child("NO SPACES")))
        .when(sp.length > 0, (el) => el.children(regions)))
      // A failed build/label job says so here instead of failing silently. After the scroll area,
      // so showing it never shifts the scroll area's place in the tree.
      .when(Boolean(this.dbg), (el) => el.child(div().absolute().bottom(0).left(0).font_family(MONO).text_size(10).text_color(t.foreground).child(String(this.dbg))));
  }

  // Legend: `01 — name` in two columns; click selects like clicking the point.
  legend(t, mine, nums, avail) {
    return h_flex().flex_wrap().w(avail).pt(4).pb(2).flex_none().font_family(MONO).text_size(9)
      .children(mine.map((s) => h_flex().id(`legend-${s.id}`).w(Math.floor(avail / 2)).h(14).gap(4).px(2).items_center().cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .on_click(() => run("space.select", { id: s.id }))
        .on_mouse_down("right", () => this.menu(s))
        .child(div().flex_none().text_color(t.solid).child(nums[s.id]))
        .child(div().flex_none().text_color(t.dim).child("—"))
        .child(div().flex_1().min_w(0).truncate().text_color(s.active ? t.foreground : t.muted).child(s.name))));
  }

  // The tag job: place tags, then build their paths (cut box, active border), the leaders and the agent rings.
  tags(items, avail, key) {
    const at = labels(items, avail);
    let lead = PathBuilder.stroke(1);
    for (const p of Object.values(at)) lead = lead.move_to(...p.lead[0]).line_to(...p.lead[1]);
    for (const p of Object.values(at)) {
      const poly = [[4, 0], [p.w, 0], [p.w, p.h], [0, p.h], [0, 4]];
      p.fill = PathBuilder.fill().add_polygon(poly, true).build();
      p.edge = PathBuilder.stroke(1).add_polygon(poly.map(([x, y]) => [Math.min(p.w - 0.5, Math.max(0.5, x)), Math.min(p.h - 0.5, Math.max(0.5, y))]), true).build();
    }
    const rings = {};
    for (const it of items) {
      const by = {};
      for (const a of ring(it.states, 9, ART / 2, ART / 2)) {
        let pb = by[a.status] ?? PathBuilder.stroke(1);
        pb = pb.move_to(...a.pts[0]);
        for (const q of a.pts.slice(1)) pb = pb.line_to(...q);
        by[a.status] = pb;
      }
      rings[it.id] = Object.entries(by).map(([status, pb]) => ({ status, path: pb.build() }));
    }
    return { key, at, rings, leaders: Object.keys(at).length ? lead.build() : null };
  }

  // Terrain and built paths per region, rebuilt only when names, tab counts, machines or width change.
  // Heavy (terrain, collision search): it runs in a spawned task, outside render's time budget,
  // and render draws the last finished result (or nothing for a moment).
  geometry(m, mine, avail) {
    const input = mine.map((s) => ({ id: s.id, name: s.name, tabs: s.tabs?.length ?? 0 }));
    const key = JSON.stringify([input, avail, m]);
    const have = this.memo[m];
    if (have?.key !== key && !this.building.has(key)) {
      this.building.set(key, () => { this.memo[m] = this.build(m, input, avail, key); });
      this.pump();
    }
    // A stale result is still drawable while its points are the same spaces.
    const ids = new Set(input.map((s) => s.id));
    return have && have.points.length === ids.size && have.points.every((b) => ids.has(b.id)) ? have : null;
  }

  // Queued jobs (terrain builds, label placement) run one per timer tick: render and each tick
  // have a time budget, so two builds in one tick could be cut off.
  pump() {
    if (this.pumping || !this.building.size) return;
    this.pumping = true;
    this.acx.timer.after(1, (cx) => {
      const [key, job] = this.building.entries().next().value;
      try { job(); } catch (e) { this.dbg = `err ${String(e?.message ?? e).slice(0, 120)}`; }
      this.building.delete(key);
      this.pumping = false;
      cx.notify();
      this.pump();
    });
  }

  build(m, input, avail, key) {
    const g = region(input, avail, m ?? "This computer");
    const rects = (list) => { let p = PathBuilder.fill(); for (const [x, y, w, h] of list) p = p.add_polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true); return list.length ? p.build() : null; };
    const lines = (list, wd) => { let p = PathBuilder.stroke(wd); for (const l of list) { p = p.move_to(...l[0]); for (const q of l.slice(1)) p = p.line_to(...q); } return list.length ? p.build() : null; };
    let isl = PathBuilder.fill();
    for (const poly of g.islets ?? []) isl = isl.add_polygon(poly, true);
    return (this.memo[m] = { key, points: g.points, height: g.height, land: g.land,
      landFill: g.land && PathBuilder.fill().add_polygon(g.land, true).build(),
      coast1: g.land && PathBuilder.stroke(1).add_polygon(g.land, true).build(),
      coast6: g.land && PathBuilder.stroke(5).add_polygon(g.land, true).build(),
      suburbs: g.land && rects(g.suburbs), islets: g.islets?.length ? isl.build() : null,
      river: g.river ? lines([g.river.pts], g.river.w) : null, banks: g.river ? lines([g.river.pts], g.river.w + 2) : null,
      roads: g.land ? lines(g.lines, 1) : null, bridges: g.bridges?.length ? lines(g.bridges, 1) : null });
  }

  // Hover: open the card after 300ms; it stays while the pointer is on the point, its tag or the card,
  // and closes 250ms after it has left both.
  hoverDistrict(id, on, cx) {
    if (on) {
      this.over = id;
      if (this.card === id) return;
      this.acx.timer.after(300, (cx) => { if (this.over === id && this.card !== id) { this.card = id; cx.notify(); } });
    } else {
      if (this.over === id) this.over = null;
      this.closeSoon();
    }
    cx.notify();
  }

  closeSoon() {
    this.acx.timer.after(250, (cx) => {
      if (this.card && this.over !== this.card && !this.inCard) { this.card = null; cx.notify(); }
    });
  }

  // A point: 7px diamond in the most urgent state's colour inside a ring split into one arc per agent.
  // Active: an accent ring at 12px and corner brackets. The 28px box is the hit area.
  point(t, { s, agents: mine, quest }, p, arcs, anim) {
    const top = mine[0] ? norm(mine[0].status) : "idle"; // sorted most urgent first
    const W = globalThis.window, o = (HIT - ART) / 2;
    const art = (el) => el.absolute().left(o).top(o).size(ART);
    const diamond = div().absolute().left(HIT / 2 - 3.5).top(HIT / 2 - 3.5).size(7).child(W.paint_path(DIAMOND, top === "idle" ? t.muted : stateColor(t, top)).size(7))
      .when(anim && top === "blocked", (el) => el.loop("opacity", { from: -6, to: 7, period: 900, easing: "linear" }))
      .when(anim && top === "working", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1400 }));
    const corner = (x, y, b) => b(div().absolute().size(8).border_color(t.accent)).left(HIT / 2 + x).top(HIT / 2 + y);
    return div().id(`point-${s.id}`).absolute().left(p.x - HIT / 2).top(p.y - HIT / 2).size(HIT).cursor_pointer()
      .on_hover((h, cx) => this.hoverDistrict(s.id, h, cx))
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () => this.menu(s))
      .when(!mine.length, (el) => el.child(art(W.paint_path(RING9, Background.solid(t.muted).opacity(0.6)))))
      .children((arcs ?? []).map((a) => art(W.paint_path(a.path, stateColor(t, a.status)))))
      .when(s.active, (el) => el.child(art(W.paint_path(RING12, t.accent)))
        .child(corner(-16, -16, (d) => d.border_t(1).border_l(1))).child(corner(8, -16, (d) => d.border_t(1).border_r(1)))
        .child(corner(-16, 8, (d) => d.border_b(1).border_l(1))).child(corner(8, 8, (d) => d.border_b(1).border_r(1))))
      .child(diamond)
      .when(this.card === s.id, (el) => el.child(Popup.new(`card-${s.id}`, div().size(1))
        .absolute().top(0).right(-4).anchor("top_left")
        .content(this.hoverCard(t, s, mine, quest, anim))));
  }

  // The tag: yellow box with a 4px top-left cut (blocked: red), `NN NAME` over the details line.
  tag(t, s, p, blocked, kids = []) {
    if (!p) return div();
    const W = globalThis.window, ink = t.solid_foreground ?? t.canvas;
    const at = (el) => el.absolute().top(0).left(0).size_full();
    return v_flex().id(`tag-${s.id}`).absolute().left(p.x).top(p.y).w(p.w).h(p.h).px(4).pt(2).cursor_pointer()
      .on_hover((h, cx) => this.hoverDistrict(s.id, h, cx))
      .on_click(() => run("space.select", { id: s.id }))
      .on_mouse_down("right", () => this.menu(s))
      .child(at(W.paint_path(p.fill, blocked ? t.blocked : t.solid)))
      .when(Boolean(s.active), (el) => el.child(at(W.paint_path(p.edge, t.accent))))
      .child(div().h(13).whitespace_nowrap().overflow_hidden().font_family("Rajdhani").font_bold().text_size(11).text_color(ink).child(p.line1))
      .when(Boolean(p.sub), (el) => el.child(div().h(10).whitespace_nowrap().overflow_hidden().font_family(MONO).text_size(8.5).text_color(ink).child(p.sub)))
      // Worktree lines: click one to go to that space instead of the repo's.
      .children((p.more ?? []).map((line, i) => div().id(`tag-${s.id}-wt-${i}`).h(10).whitespace_nowrap().overflow_hidden().font_family(MONO).text_size(8.5).text_color(ink)
        .when(kids.length === 1, (el) => el.on_click((_e, cx) => { cx.stop_propagation(); run("space.select", { id: kids[0].s.id }); }))
        .child(line)));
  }

  // Every agent of the space, most urgent first, sub-agents indented under their parent.
  hoverCard(t, s, mine, quest, anim) {
    const all = terminals() ?? [], byAddr = new Map(all.map((x) => [x.address, x]));
    const listed = new Map(mine.map((a) => [a.address, a]));
    const now = Date.now();
    const tabs = new Set((s.tabs ?? []).map((c) => c.id));
    const branch = panes().find((p) => tabs.has(p.tab) && p.branch)?.branch;
    const top = mine.filter((a) => !listed.has(byAddr.get(a.address)?.parent))
      .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || b.seq - a.seq);
    const rows = [];
    const walk = (addr, depth) => {
      for (const k of all.filter((x) => x.parent === addr && x.state === "live")) {
        const st = listed.get(k.address)?.status ?? (k.status === "error" ? "blocked" : k.status === "done" ? "idle" : k.status ?? "idle");
        rows.push({ address: k.address, name: k.name || k.template || k.program?.name || k.address, program: k.program, status: st, depth, at: k.status_ms });
        walk(k.address, depth + 1);
      }
    };
    for (const a of top) {
      const x = byAddr.get(a.address);
      rows.push({ address: a.address, name: a.tab_name && !/^\d+$/.test(a.tab_name) ? a.tab_name : a.title || a.program?.name || a.address, program: a.program, status: a.status, depth: 0, at: x?.status_ms });
      walk(a.address, 1);
    }
    const shown = rows.slice(0, 12);
    return v_flex().id(`card-body-${s.id}`).w(250).px(10).pt(8).pb(10).gap(2).bg(t.popover).border_1().border_color(t.accent)
      .on_hover((h, cx) => { this.inCard = h; if (!h) this.closeSoon(); cx.notify(); })
      .child(div().truncate().font_family("Rajdhani").font_bold().text_size(13).text_color(t.foreground).child(s.name.toUpperCase()))
      .child(h_flex().gap(8).items_center().font_family(MONO).text_size(9).text_color(t.dim)
        .child(div().flex_none().child(`DISTRICT // ${hex3(s.id)}`))
        .when(Boolean(quest), (el) => el.child(div().flex_none().text_color(t.muted).child(`◆${quest.milestones} ◇${quest.issues}`))))
      .when(Boolean(branch), (el) => el.child(div().truncate().font_family(MONO).text_size(10).text_color(t.muted).child(branch)))
      .child(div().h(1).my(4).w_full().bg(t.border))
      .when(!rows.length, (el) => el.child(div().font_family(MONO).text_size(10).text_color(t.dim).child("NO ACTIVE AGENTS")))
      .children(shown.map((r) => h_flex().id(`card-ag-${r.address}`).h(22).pl(r.depth * 12).gap(6).items_center().cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .on_click(() => run("agent.focus", { terminal: r.address }))
        .when(r.depth > 0, (el) => el.child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child("└")))
        .when(Boolean(icon(r.program, 14, t.foreground)), (el) => el.child(icon(r.program, 14, t.foreground)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(r.status === "idle" ? t.muted : t.foreground).child(r.name))
        .when(typeof r.at === "number" && r.at > 1e12, (el) => el.child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child(duration(now - r.at))))
        .child(chip(t, r.status, anim))))
      .when(rows.length > 12, (el) => el.child(div().pt(2).font_family(MONO).text_size(9).text_color(t.dim).child(`+${rows.length - 12} MORE`)));
  }

  render() {
    const t = theme();
    const collapsed = narrow();
    return v_flex().size_full().min_h(0).bg(t.chrome).text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().justify_between().text_size(11.5).text_color(t.dim)
        .when(collapsed, el => el.pl(0).pr(0).justify_center())
        .when(!collapsed, el => el.child(label(t, "Spaces")))
        .child(div().id("space-new").size(26).flex_none().flex().items_center().justify_center().rounded(0).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => run("space.new")).child(svg("mods/workspace-chrome/plus.svg").size(14))))
      .when(!collapsed, el => el.child(v_flex().px(16).pb(4).flex_none().child(rule(t))).child(this.map(t)))
      // ponytail: the rail (<160px) is too narrow for the map, so it keeps its numbered cells.
      .when(collapsed, el => el.child(v_flex().flex_1().min_h(0).pb(14).overflow_y_scrollbar().children(spaces().map((w, i) => this.compact(w, i, t)))));
  }
}
