// Agents in grouped or priority views; parents take their most urgent sub-agent's place.

import { View, div, image, svg, PathBuilder, Background } from "gpui-kit";
import { v_flex, h_flex, Popup } from "gpui-base";
import { telemetry, threat } from "./telemetry.js";
import { exec, agents, terminals, panes, focused, spaces, run, theme, shared, setShared, setAgentOrder, openOverlay, closeOverlay, props, window, layout } from "herdr";

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

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Cyberneon: every animation stops when the shared switch is false (undefined = on).
const anim = () => shared("cyberneon.animations") !== false;
const MONO = "Share Tech Mono";
const LABEL = "Chakra Petch";
const W = globalThis.window; // herdr's window() shadows the paint_path host
// Top-left 45° cut, % coords so no measuring (herdr-fit §1.1 A).
const notch = (c) => PathBuilder.fill().add_polygon([[c, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, c]], true).build();
const fill = (bg) => W.paint_path(notch(4), bg).absolute().top(0).left(0).size_full();
const blink = (el) => (anim() ? el.loop("opacity", { from: -6, to: 7, period: 900, easing: "linear" }) : el);
// Corner bracket (v2 COMMON): 1px accent, 8px legs, in an absolute 8×8 box.
const bracket = (t, side) => {
  const el = div().absolute().top(0).size(8).border_t(1).border_color(t.accent);
  return side === "left" ? el.left(0).border_l(1) : el.right(0).border_r(1);
};
// v3 scan card: the state's chip word and helpers (THREAT is threat() in telemetry.js).
const WORD = { blocked: "INPUT REQ", done: "COMPLETE", working: "EXEC", idle: "STANDBY" };
// `t1f` → `0x01F` (same as cyberneon-pane); a remote `vps/t7` uses its last part.
const hexOf = (addr) => {
  const n = parseInt(String(addr ?? "").split("/").pop().replace(/^t/, ""), 16);
  return Number.isNaN(n) ? "0x???" : "0x" + n.toString(16).toUpperCase().padStart(3, "0");
};
// ponytail: char-count truncation from the left (~30 mono chars fit the value column).
const tail = (s, n = 30) => (s.length > n ? "…" + s.slice(-(n - 1)) : s);
const home = (s) => s.replace(/^\/(Users|home)\/[^/]+/, "~");
const BAR = ["▰▱▱▱", "▰▰▱▱", "▱▰▰▱", "▱▱▰▰", "▱▱▱▰", "▱▱▱▱"];

const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();

function leadPanes(all) {
  const leads = new Map();
  for (const p of all) {
    if (!p.terminal) continue;
    const current = leads.get(p.tab);
    // First agent, else first focused terminal, else first terminal in the tab.
    if (!current || (!current.program?.agent && (p.program?.agent || (!current.focused && p.focused)))) leads.set(p.tab, p);
  }
  return leads;
}

function title(tab, l) {
  const prog = l?.program?.name;
  const live = clean(l?.title);
  // clean() would strip a path's leading ~ or /: test the title with only its status glyph gone.
  const path = /^[~/]|^[A-Za-z]:\\/.test((l?.title ?? "").replace(/^[^\p{L}\p{N}~/]+/u, ""));
  const telling = live && live !== prog && !path && !live.includes("@") && live.toLowerCase() !== l?.program?.key;
  return (tab.name === prog || !tab.named) && telling ? live : tab.name;
}
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
// A sub-agent without a pane isn't in agents(): its raw word, error counting as
// blocked. It's never done: it reports to its parent, and the parent's done is the news.
const kidStatus = (k, listed) => {
  const s = listed.get(k.address) ?? k.status;
  return s === "error" ? "blocked" : s === "done" ? "idle" : s;
};
const SORTS = [
  { id: "priority", label: "Priority", icon: "clock" },
  { id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };

function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

// Worktree spaces read as their repo's: "herdr-gallery ↳ M1". Same rule as the map's worktreeParents()
// (cyberneon-spaces/districts.js; mods can't import each other): a space in Herdr's ~/.herdr/worktrees/<repo>/<branch>
// belongs to another space on that machine with a <repo> folder segment, the one closest to the repo root.
const WT = /\/\.herdr\/worktrees\/([^/]+)\/([^/]+)/;
const shortBranch = (b) => { const m = String(b).match(/^(milestone|issue)-(\d+)/); return m ? (m[1] === "milestone" ? `M${m[2]}` : `#${m[2]}`) : String(b).slice(0, 14); };
function spaceNames() {
  const sp = spaces(), ps = panes(), out = new Map();
  const place = (s) => { const tb = new Set((s.tabs ?? []).map((c) => c.id)); return ps.find((p) => tb.has(p.tab) && p.cwd)?.cwd || s.folder || ""; };
  for (const k of sp) {
    const m = place(k).match(WT);
    if (!m) continue;
    let best = null, depth = Infinity;
    for (const s of sp) {
      if (s.id === k.id || (s.machine ?? null) !== (k.machine ?? null) || WT.test(place(s))) continue;
      const seg = place(s).split("/"), at = seg.lastIndexOf(m[1]);
      if (at >= 0 && seg.length - at < depth) { best = s; depth = seg.length - at; }
    }
    if (best) out.set(k.id, `${best.name} ↳ ${shortBranch(m[2])}`);
  }
  return out;
}

export default class Agents extends View {
  init(_props, cx) {
    if (props()?.sortMenu) return;
    this.folded = new Set();
    // Each agent's last state and when it changed (ms), kept across restarts.
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    this.pendingPins = JSON.parse(localStorage.getItem("pins") ?? "[]");
    if (!this.pendingPins.length) localStorage.removeItem("pins");
    this.migratingPins = new Set();
    this.acx = cx; // timers need init's AsyncContext
    this.scan = null; // address whose scan card is open
    this.sweep = null; // "start" → "go" → null: the one-shot scan line
    this.tele = new Map(); // address → { at, data }: data undefined while loading, null if none
    cx.timer.every(30000, (cx) => cx.notify());
  }

  // Stamps agents whose state changed. Done and idle count as one: looking at a
  // finished agent turns done into idle, and looking isn't the agent doing anything.
  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    // Gone and old: the list alone is empty right after a start.
    const listed = new Set(list.map((a) => a.address));
    for (const [k, c] of Object.entries(this.changed)) if (!listed.has(k) && now - c.at > 30 * 86400000) delete this.changed[k];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  // Keep offline pins until their terminal returns, and keep each pending until
  // core echoes the label so a failed write doesn't erase the old pin.
  migratePins(all) {
    const listed = new Map(all.filter((t) => t.state === "live").map((t) => [t.address, t]));
    const pending = this.pendingPins.filter((address) => {
      const terminal = listed.get(address);
      if (!terminal) return true;
      if (terminal.labels?.["herdr.pinned"]) return false;
      if (!this.migratingPins.has(address)) {
        this.migratingPins.add(address);
        run("terminal.pin", { terminal: address, pinned: true });
      }
      return true;
    });
    if (pending.length === this.pendingPins.length) return;
    this.pendingPins = pending;
    if (pending.length) localStorage.setItem("pins", JSON.stringify(pending));
    else localStorage.removeItem("pins");
  }

  since(a) {
    return this.changed[a.address]?.at ?? 0;
  }

  rank(a) {
    return RANK[a.status] ?? 0;
  }

  sortMenu(t) {
    const on = sortOf().id;
    return v_flex()
      .w_full()
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map((s) => h_flex()
        .id(`sort-${s.id}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(0)
        .items_center()
        .text_color(t.foreground)
        .hover((el) => el.bg(t.hover))
        .on_click(() => {
          setShared("agents.sort", s.id);
          closeOverlay(props().overlay);
        })
        .child(svg(`mods/workspace-chrome/${s.icon}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(s.label))
        .when(s.id === on, (el) => el.child(svg("mods/workspace-chrome/check.svg").size(14).flex_none().text_color(t.foreground)))));
  }

  peek(addr) {
    run("terminal.peek", { terminal: addr });
  }

  // Live sub-agents of `addr`, depth first, each with the tree lines in front of it.
  tree(all, addr, lead = []) {
    const kids = all.filter((k) => k.parent === addr && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [
        { t: k, lines: [...lead, last ? "└" : "├"] },
        ...this.tree(all, k.address, [...lead, last ? "" : "│"]),
      ];
    });
  }

  subRow(t, s, shown, compact) {
    const k = s.t;
    const st = kidStatus(k, this.listed);
    const pic = icon(k.program, 14, t.foreground);
    const on = k.address === shown;
    return h_flex()
      .id(`sub-${k.address}`)
      .pl(39)
      .pr(8)
      .rounded(0)
      .h(26)
      .flex_none()
      .gap(0)
      .items_center()
      .text_size(12.5)
      .when(on, (el) => el.bg(t.raised))
      .hover((s) => s.bg(t.hover))
      .on_click(() => (this.listed.has(k.address) ? run("pane.focus", { terminal: k.address }) : this.peek(k.address)))
      .children(s.lines.map(l => div().self_start().mt(-4).w(9).h(17).mr(4).flex_none()
        .when(Boolean(l), el => el.border_l(1).border_color(t.border))
        .when(l === "└" || l === "├", el => el.border_b(1))))
      .when(Boolean(pic), el => el.child(div().mr(8).child(pic)))
      .child(div().flex_1().truncate().text_color(on ? t.foreground : t.muted).child(k.name || k.template || k.program?.name || k.address))
      .child(this.status(t, { status: st }, compact));
  }

  // compact: 6×6 squares (and a small hazard "!") where a header already names the state.
  status(t, a, compact = false) {
    const sq = (el) => el.size(6).mx(4).flex_none().rounded(0);
    const chip = () => div().relative().flex_none().h(16).px(6).flex().items_center().text_size(10.5).font_family(LABEL).font_semibold();
    if (a.status === "blocked") {
      // Solid red chip that never disappears; only the dark stripes over it blink.
      const stripes = () => [fill(t.blocked), blink(div().absolute().top(0).left(0).size_full().child(fill(Background.pattern_slash("#0a0b0f59", 2, 6))))];
      const ink = div().relative().text_color(t.solid_foreground ?? t.canvas).font_bold();
      if (compact) return chip().px(0).w(14).justify_center().children(stripes()).child(ink.child("!"));
      return chip().children(stripes()).child(ink.child("INPUT REQ"));
    }
    if (a.status === "done") {
      if (compact) return sq(div()).bg(t.done);
      const c = chip().bg(t.done).child(div().text_color(t.solid_foreground ?? t.canvas).child("COMPLETE"));
      return anim() ? c.loop("opacity", { from: 0.6, to: 1, period: 1400 }) : c;
    }
    if (a.status === "working") {
      if (compact) return sq(div()).bg(t.working);
      const bar = div().font_family(MONO).text_size(10).text_color(t.working);
      return h_flex().flex_none().gap(4).items_center()
        .child(div().font_family(LABEL).font_semibold().text_size(10.5).text_color(t.working).child("EXEC"))
        .child(anim() ? bar.frames(BAR, 110) : bar.child("▰▰▱▱"));
    }
    // Idle (STANDBY): a 1px hollow square.
    return sq(div()).border(1).border_color(t.idle ?? t.dim);
  }

  // Hover rested 400ms on a row: open its card. Leaving the row (or another row) cancels.
  arm(addr) {
    this.arming = addr;
    this.acx.timer.after(400, (cx) => {
      if (this.arming !== addr) return;
      this.scan = addr;
      this.sweep = anim() ? "start" : null;
      this.readUsage(addr);
      cx.notify();
    });
  }

  // v5: read the agent's screen once per card open (cached 20s), read-only, never polled.
  // Remote `machine/tN` addresses go through the same `hc read`.
  readUsage(addr) {
    const hit = this.tele.get(addr);
    if (hit && Date.now() - hit.at < 20000) return;
    const entry = { at: Date.now(), data: undefined };
    this.tele.set(addr, entry);
    // ponytail: hc read has no tail option (only --lines of history above), so take the last 8 lines here.
    this.acx.spawn(async (cx) => {
      try {
        const r = await exec("hc", ["read", addr], { timeout: 5000 });
        entry.data = r.code === 0 ? telemetry(r.stdout) : null;
      } catch { entry.data = null; }
      cx.notify();
    });
  }

  // No addr: drop everything. With one: only what belongs to that row (its hover-out can
  // arrive after the next row's hover-in).
  disarm(addr) {
    if (!addr || this.arming === addr) this.arming = null;
    if (!addr || this.scan === addr) { this.scan = null; this.sweep = null; }
  }

  // v5 //TELEMETRY: MODEL, then CONTEXT / 5H / 7D as 8-segment bars. While loading it
  // reserves the full block's height, so the card doesn't jump when the numbers land.
  telemetrySection(t, addr, line) {
    const tel = this.tele.get(addr)?.data;
    const note = (s) => div().font_family(MONO).text_size(9).text_color(t.dim).child(s);
    const bar = (k, v, reset) => {
      const tone = v > 80 ? t.blocked : v >= 50 ? t.done : t.working;
      const lit = Math.round((Math.min(100, v) / 100) * 8);
      return h_flex().h(16).gap(8).items_center()
        .child(div().flex_none().w(62).font_family(LABEL).font_semibold().text_size(9).text_color(t.dim).child(k))
        .child(h_flex().flex_1().gap(2).children([0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
          div().flex_1().h(6).rounded(0).when(i < lit, (el) => el.bg(tone)).when(i >= lit, (el) => el.border(1).border_color(t.border)))))
        .child(div().flex_none().w(30).text_right().font_family(MONO).text_size(11).text_color(t.foreground).child(`${v}%`))
        .child(div().flex_none().w(46).truncate().font_family(MONO).text_size(9).text_color(t.dim).child(reset ? `⟳${reset}` : ""));
    };
    const body = tel === undefined ? [note("SCANNING…")]
      : tel === null ? [note("NO TELEMETRY")]
      : [
        tel.model && line("MODEL", tel.model),
        tel.ctx != null && bar("CONTEXT", tel.ctx),
        tel.h5 != null && bar("5H", tel.h5, tel.h5Reset),
        tel.d7 != null && bar("7D", tel.d7, tel.d7Reset),
        tel.cost && line("COST", tel.cost),
        (tel.h5 != null || tel.d7 != null) && div().pl(70).font_family(MONO).text_size(8).text_color(t.dim).child("ACCOUNT-WIDE"),
      ].filter(Boolean);
    return v_flex().pt(6).gap(1)
      .child(div().font_family(MONO).text_size(9).text_color(t.dim).opacity(0.7).child("//TELEMETRY"))
      .child(v_flex().gap(1).when(tel === undefined, (el) => el.min_h(78)).children(body));
  }

  scanCard(t, a, name, p, x) {
    // THREAT (combined): state, plus context pressure from //TELEMETRY and how long it has been blocked.
    const since = this.since(a);
    const thr = threat(a.status, this.tele.get(a.address)?.data?.ctx ?? null, since ? Date.now() - since : null);
    const lit = thr.level, tone = thr.tone;
    const born = typeof x?.created_ms === "number" ? x.created_ms : null; // terminals(): created_ms, turn
    const line = (k, v, color = t.foreground) => h_flex().h(16).gap(10).items_center()
      .child(div().flex_none().w(62).font_family(LABEL).font_semibold().text_size(9).text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).truncate().text_right().font_family(MONO).text_size(11).text_color(color).child(v));
    const cut = (c) => PathBuilder.fill().add_polygon([[c, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, c]], true).build();
    const bk = (v, h) => {
      let el = div().absolute().size(8).border_color(t.accent);
      el = v === "top" ? el.top(4).border_t(1) : el.bottom(4).border_b(1);
      return h === "left" ? el.left(4).border_l(1) : el.right(4).border_r(1);
    };
    return v_flex()
      .id("scan-card")
      .relative()
      .w(260)
      .px(14)
      .pt(10)
      .pb(12)
      .gap(2)
      .overflow_hidden()
      .on_size_change((size, cx) => {
        if (this.sweep !== "start") return;
        this.sweepTo = size.height - 1;
        this.sweep = "go";
        cx.timer.after(290, (cx) => { this.sweep = null; cx.notify(); });
        cx.notify();
      })
      // 1px accent edge that follows the 10px cut: accent fill, then raised inset by 1.
      .child(W.paint_path(cut(10), t.accent).absolute().top(0).left(0).size_full())
      .child(W.paint_path(cut(9), t.raised).absolute().top(1).left(1).right(1).bottom(1))
      .child(bk("top", "right")).child(bk("bottom", "left")).child(bk("bottom", "right"))
      .child(div().relative().font_family(MONO).text_size(9).text_color(t.accent).child(`SCAN // ${hexOf(a.address)}`))
      .child(div().relative().pb(6).truncate().font_bold().text_size(16).text_color(t.foreground).child(name))
      .child(v_flex().relative().gap(1)
        .child(line("CLASS", a.program?.name ?? a.app ?? "?"))
        .child(line("STATUS", WORD[a.status] ?? String(a.status).toUpperCase(), t[a.status] ?? t.foreground))
        .when(born != null, (el) => el.child(line("UPTIME", duration(Date.now() - born))))
        .when(typeof x?.turn === "number", (el) => el.child(line("TURNS", String(x.turn))))
        .child(line("DISTRICT", spaceNames().get(a.space) ?? (a.space_name || "?")))
        .when(Boolean(p?.cwd), (el) => el.child(line("PATH", tail(home(p.cwd)))))
        .when(Boolean(p?.branch), (el) => el.child(line("BRANCH", p.branch)))
        .child(this.telemetrySection(t, a.address, line))
        .child(h_flex().h(16).pt(4).gap(10).items_center()
          .child(div().flex_none().w(62).font_family(LABEL).font_semibold().text_size(9).text_color(t.dim).child("THREAT"))
          .child(h_flex().flex_1().gap(3).children([0, 1, 2, 3, 4].map((i) =>
            div().flex_1().h(6).rounded(0).when(i < lit, (el) => el.bg(t[tone] ?? t.dim)).when(i >= lit, (el) => el.border(1).border_color(t.border))))))
        // What raised it, e.g. "CTX 82% · WAIT 12M"; nothing when it's just the state.
        .when(Boolean(thr.why), (el) => el.child(div().pl(72).font_family(MONO).text_size(8.5).text_color(t[tone] ?? t.dim).child(thr.why))))
      // One-shot sweep: drawn at top 0, moved to the bottom by on_size_change, carried by `.transition`.
      .when(anim() && this.sweep !== null, (el) => el.child(div().absolute().left(1).right(1).h(1).bg(t.working)
        .top(this.sweep === "go" ? this.sweepTo : 0)
        .transition("top", { duration: 250, easing: "linear" })));
  }

  render(cx) {
    const t = theme();
    if (props()?.sortMenu) return this.sortMenu(t);
    const collapsed = narrow();
    const sort = sortOf();
    let list = agents();
    this.listed = new Map(list.map((a) => [a.address, a.status]));
    const all = terminals();
    this.migratePins(all);
    const shown = focused()?.agent;
    const now = Date.now();
    this.track(list, now);
    // A kept sub-agent (one with a pane) is in agents() too: where a tree shows
    // it, it gets no row of its own, unless it's pinned.
    const nested = new Set(collapsed ? [] : list.flatMap((a) => this.tree(all, a.address).map((s) => s.t.address)));
    list = list.filter((a) => a.pinned || !nested.has(a.address));
    const tabCounts = new Map();
    for (const a of list) tabCounts.set(a.tab, (tabCounts.get(a.tab) ?? 0) + 1);
    const byPriority = sort.id === "priority";
    const urgency = new Map(list.map((a) => [a.address, Math.max(this.rank(a), ...this.tree(all, a.address).map((s) => RANK[kidStatus(s.t, this.listed)] ?? 0))]));
    // A worktree space (a milestone: its lead and issue tabs) moves as one: its members share the most urgent
    // member's rank and place, lead (an `M<n>` tab) first.
    const names = spaceNames(), fam = (a) => (names.has(a.space) ? `wt:${a.space}` : a.address);
    const famRank = new Map();
    for (const a of list) famRank.set(fam(a), Math.max(famRank.get(fam(a)) ?? 0, urgency.get(a.address)));
    const rankOf = (a) => famRank.get(fam(a));
    if (byPriority) {
      const sorted = [...list].sort((x, y) => rankOf(y) - rankOf(x) || this.since(y) - this.since(x) || y.seq - x.seq);
      const lead = (a) => (/^M\d+$/.test(a.tab_name ?? "") ? 0 : 1), done = new Set();
      list = sorted.flatMap((a) => {
        if (done.has(fam(a))) return [];
        done.add(fam(a));
        return sorted.filter((b) => fam(b) === fam(a)).sort((x, y) => lead(x) - lead(y));
      });
    }
    const pinned = list.filter((a) => a.pinned);
    const rest = list.filter((a) => !a.pinned);
    list = [...pinned, ...rest];
    setAgentOrder(list.map((a) => a.address));

    const withKids = (a, i) => {
      const subs = collapsed ? [] : this.tree(all, a.address);
      const r = row(a, i, subs);
      if (this.folded.has(a.address)) return [r];
      return [r, ...subs.map((s) => this.subRow(t, s, shown, byPriority))];
    };

    // The fold chevron; folded, the count too, colored by the most urgent one.
    const fold = (a, subs) => {
      const sts = subs.map((s) => kidStatus(s.t, this.listed));
      const top = sts.reduce((m, s) => ((RANK[s] ?? 0) > (RANK[m] ?? 0) ? s : m), null);
      const open = !this.folded.has(a.address);
      return div()
        .id(`fold-${a.address}`)
        .h(18)
        .px(3)
        .gap(3)
        .flex()
        .items_center()
        .rounded(0)
        .text_size(11)
        .font_family(MONO)
        .text_color(open ? t.dim : (t[top] ?? t.dim))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          open ? this.folded.add(a.address) : this.folded.delete(a.address);
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/chevron-${open ? "down" : "right"}.svg`).size(11).flex_none())
        .when(!open, (el) => el.child(String(subs.length)));
    };

    // A row reads "space \u00b7 detail": the detail is a tab someone named or the
    // agent's own title, never an automatic tab number unless two rows would
    // otherwise read the same.
    // Read the pane snapshot once: every host read copies the whole list into JS.
    const paneList = panes();
    const leads = leadPanes(paneList);
    const tabs = new Map(spaces().flatMap(s => s.tabs).map(tab => [tab.id, tab]));
    const labels = new Map(list.map(a => {
      const tab = tabs.get(a.tab);
      const many = tabCounts.get(a.tab) > 1;
      return [a.address, tab ? title(many ? { ...tab, named: false } : tab, many ? a : leads.get(a.tab)) : (a.title || a.program?.name || "")];
    }));
    const label = (a) => labels.get(a.address);
    const spName = (a) => names.get(a.space) ?? a.space_name;
    const detail = new Map(list.map(a => [a.address, /^\d+$/.test(label(a)) ? null : label(a)]));
    const seen = {};
    for (const a of list) { const k = `${a.space_name}\u0000${detail.get(a.address) ?? ""}`; seen[k] = (seen[k] ?? 0) + 1; }
    for (const a of list) {
      if (detail.get(a.address) == null && seen[`${a.space_name}\u0000`] > 1) detail.set(a.address, label(a));
    }

    const row = (a, i, subs = []) => {
      const pic = icon(a.program, 16, t.foreground);
      const more = detail.get(a.address);
      // An agent on another machine (`vps/t7`) says which.
      const machine = a.address.includes("/") ? a.address.split("/")[0] : null;
      if (collapsed) {
        return h_flex()
          .id(`ag-${a.address}`)
          .h(26)
          .px(8)
          .flex_none()
          .items_center()
          .gap(4)
          .border_l(3)
          .border_color(t[a.status] ?? t.dim)
          .when(a.status === "blocked" && !a.focused, (el) => el.bg(t.blocked + "26"))
          .when(a.focused, (el) => el.bg(t.selected))
          .hover((s) => s.bg(t.hover))
          .on_click(() => run("pane.focus", { pane: a.pane }))
          .child(div().flex_1().min_w(0).whitespace_nowrap().text_right().font_family(MONO).text_color(a.focused ? t.foreground : t.muted).child(String(i + 1)))
          .child(h_flex().w(14).flex_none().items_center().justify_center().child(this.status(t, a, true)));
      }
      const when = this.since(a);
      const idle = a.status === "idle" && !a.focused;
      const isPinned = a.pinned;
      const pin = div()
        .id(`pin-${a.address}`)
        .flex_none()
        .p(2)
        .rounded(0)
        .text_color(t.dim)
        .cursor_pointer()
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .tooltip(isPinned ? "Unpin" : "Pin to the top")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          run("terminal.pin", { terminal: a.address, pinned: !isPinned });
          // The row moves away from under the pointer, and no hover-out comes.
          this.hovered = null;
          this.disarm();
          cx.notify();
        })
        .child(svg(`mods/workspace-chrome/${isPinned ? "pin-off" : "pin"}.svg`).size(13));
      // Under a space header the space goes without saying; an automatic tab number says nothing.
      // Without a space header above (priority, pinned) the row names its space.
      const full = byPriority || isPinned;
      const name = full ? spName(a) || label(a) : more ?? (/^\d+$/.test(label(a)) ? a.program?.name || label(a) : label(a));
      return h_flex()
        .id(`ag-${a.address}`)
        .pl(7)
        .pr(6)
        .h(30)
        .flex_none()
        .rounded(0)
        .border_l(3)
        .border_color(t[a.status] ?? t.dim)
        .items_center()
        .gap(8)
        .when(a.status === "blocked" && !a.focused, (el) => el.bg(t.blocked + "26"))
        .when(a.focused, (el) => el.bg(t.selected))
        .cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_hover((on, cx) => {
          if (on) { this.hovered = a.address; this.arm(a.address); }
          else { if (this.hovered === a.address) this.hovered = null; this.disarm(a.address); }
          cx.notify();
        })
        .on_click(() => run("pane.focus", { pane: a.pane }))
        .when(Boolean(pic), el => el.child(div().id(`agent-fold-${a.address}`)
          .when(subs.length > 0, el => el.on_click((_e, cx) => {
            cx.stop_propagation();
            this.folded.has(a.address) ? this.folded.delete(a.address) : this.folded.add(a.address);
            cx.notify();
          })).child(pic)))
        .child(h_flex().flex_1().min_w(0).gap(5).items_center()
          .child(div().min_w(0).max_w(full && more ? 120 : 200).truncate().text_color(idle ? t.muted : t.foreground).child(name))
          .when(full && Boolean(more), el => el.child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(`\u00b7 ${more}`))))
        .when(Boolean(machine), el => el.child(div().font_family(MONO).text_size(10).text_color(t.dim).child(machine)))
        .when(subs.length > 0, el => el.child(fold(a, subs)))
        .when(this.hovered === a.address, el => el.child(pin))
        .when(this.hovered !== a.address && Boolean(when), el => el.child(div().flex_none().font_family(MONO).text_size(11).text_color(t.dim).child(duration(now - when))))
        .child(this.status(t, a, byPriority && !isPinned))
        // Scan card: a 1px popup trigger just past the row's right edge, so the card opens
        // beside the sidebar and never covers a row.
        .when(this.scan === a.address, (el) => el.relative().child(Popup.new(`scan-${a.address}`, div().size(1))
          .absolute().top(0).right(-10).anchor("top_left")
          .content(this.scanCard(t, a, name, paneList.find((p) => p.pane === a.pane), all.find((x) => x.address === a.address)))));
    };

    // Groups in list order: spaces (grouped) or priority sections. Agents of a
    // space are next to each other in agents(), so neighbours make a group.
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", status: null, members: pinned }] : [];
    for (const a of rest) {
      const r = rankOf(a) || RANK.idle;
      const id = byPriority ? `sec-${r}` : `sp-${a.space}`;
      if (groups.at(-1)?.id === id) groups.at(-1).members.push(a);
      else groups.push({ id, label: byPriority ? SECTION[r] : spName(a) || "", status: byPriority ? SECTION_STATUS[r] : null, members: [a] });
    }

    // A group's header; it folds the group. Folded, it says how many and the most urgent state.
    const header = (g, n) => {
      const open = !this.folded.has(g.id);
      const top = g.members.reduce((m, a) => ((RANK[a.status] ?? 0) > (RANK[m] ?? 0) ? a.status : m), null);
      // Priority sections and "Pinned" are short labels: caps. Space names keep their case.
      const text = byPriority || g.id === "pinned" ? g.label.toUpperCase() : g.label;
      return v_flex()
        .id(g.id)
        .px(4)
        .pt(10)
        .pb(4)
        .flex_none()
        .gap(3)
        .cursor_pointer()
        .on_click((_e, cx) => {
          open ? this.folded.add(g.id) : this.folded.delete(g.id);
          cx.notify();
        })
        .child(h_flex()
          .h(18)
          .gap(6)
          .items_center()
          .child(div().flex_none().font_family(MONO).text_size(9).text_color(t.dim).child(`//${String(n + 1).padStart(2, "0")}`))
          .child(div().truncate().font_family(LABEL).font_semibold().text_size(11).text_color(t.accent).child(text))
          .when(byPriority || !open, (el) => el.child(div().font_family(MONO).text_size(11).text_color(t.muted).child(String(g.members.length))))
          .child(div().flex_1())
          .when(!open, (el) => el
            .when(!byPriority && top && top !== "idle", (el) => el.child(this.status(t, { status: top }, true)))
            .child(svg("mods/workspace-chrome/chevron-right.svg").size(11).flex_none().text_color(t.dim))))
        // 1px rule with a bright 24px segment at its left end.
        .child(h_flex().h(1).w_full().child(div().w(24).h(1).flex_none().bg(t.accent)).child(div().flex_1().h(1).bg(t.border)));
    };
    const rows = collapsed
      ? list.flatMap(withKids)
      : groups.flatMap((g, n) => [header(g, n), ...(this.folded.has(g.id) ? [] : g.members.flatMap(withKids))]);

    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(13)
      .when(!collapsed, (el) =>
        el.child(
          h_flex()
            .relative()
            .px(16)
            .h(41)
            .pt(14)
            .pb(5)
            .flex_none()
            .items_center()
            .justify_between()
            .child(bracket(t, "left"))
            .child(bracket(t, "right"))
            .child(div().font_family(LABEL).font_semibold().text_size(11.5).text_color(t.muted).child("AGENTS"))
            .child(
              div()
                .id("ag-sort")
                .text_size(11)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(() => openOverlay({ mod: "cyberneon-agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } }))
                .tooltip(`Sort agents: ${sort.label}`)
                .child(svg(`mods/workspace-chrome/${sort.icon}.svg`).size(14)),
            ),
        ),
      )
      .when(list.length === 0 && !collapsed, (el) =>
        el.child(div().px(12).text_size(12).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")),
      )
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(collapsed ? 0 : 8).overflow_y_scrollbar().mode("always").children(rows))
      .when(collapsed, (el) =>
        el.child(
          h_flex()
            .h(28)
            .items_center()
            .justify_center()
            .child(
              div()
                .id("collapse")
                .text_size(13)
                .text_color(t.dim)
                .hover((s) => s.text_color(t.foreground))
                .on_click(toggleSidebar)
                .child("»"),
            ),
        ),
      );
  }
}
