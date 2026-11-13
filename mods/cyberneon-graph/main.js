import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, Popup } from "gpui-base";
import { panes, spaces, exec, shared, theme, watchFolder } from "herdr";
import { lanes, parseLog, parseShow, ago } from "./graph.js";

// GRAPH page in the right panel: the focused repo's commit graph, local and read-only (git log/show only).
const MONO = "Share Tech Mono";
const LABEL = "Chakra Petch";
const W = globalThis.window; // herdr's window() shadows the paint_path host
const ROW = 24, LANE = 12, GX = 4, MAXL = 16, N = 300;
const COLORS = ["accent", "working", "done", "ansi5", "ansi9", "ansi6"];
const anim = () => shared("cyberneon.animations") !== false;
const notch = (c) => PathBuilder.fill().add_polygon([[c, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, c]], true).build();
const notchEdge = (c) => PathBuilder.stroke(1).add_polygon([[c, 0.5], ["100%", 0.5], ["100%", "100%"], [0.5, "100%"], [0.5, c]], true).build();
// Read-only git: never takes optional locks and never starts fsmonitor, so nothing is written under .git.
const git = (dir, on, args) => exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", dir, ...args], { on, timeout: 10_000 });
const errLine = (r) => (r.stderr || r.stdout || `exit ${r.code}`).trim().split("\n")[0].replace(/^fatal: /, "").slice(0, 60);

// The repo folder: the focused pane's, else the active space's (same as cyberneon-jobs).
function where() {
  const space = spaces().find((s) => s.active);
  return { folder: panes().find((p) => p.focused)?.cwd || space?.folder || null, on: space?.machine ?? null };
}

export default class Graph extends View {
  init(_props, cx) {
    this.acx = cx; // render's cx dies with the call; timers and spawns come from here
    this.scope = (() => { try { return localStorage.getItem("scope") ?? "all"; } catch { return "all"; } })();
    this.ctx = null; // { folder, on, top, gitDir } | { folder, error }
    this.raw = null; // { key, commits } | { error }
    this.view = null; // { key, rows, width } from the queued lane job
    this.scrollY = 0;
    this.vh = 400;
    this.details = new Map(); // hash → { data } | { error } | {} while loading
    this.load(cx);
  }

  // Rerun at most once per 2s (watch events come in bursts).
  want() {
    if (this.queued) return;
    this.queued = true;
    this.acx.timer.after(Math.max(1, 2000 - (Date.now() - (this.lastRun ?? 0))), (cx) => { this.queued = false; this.load(cx); });
  }

  load(cx) {
    if (this.loading) { this.want(); return; }
    this.loading = true;
    this.lastRun = Date.now();
    cx.spawn(async (cx) => {
      try { await this.fetch(); } catch (e) { this.raw = { error: String(e?.message ?? e).slice(0, 60) }; }
      this.loading = false;
      cx.notify();
    });
  }

  async fetch() {
    const { folder, on } = where();
    this.lastFolder = folder;
    if (!folder) { this.ctx = null; return; }
    if (this.ctx?.folder !== folder || this.ctx?.on !== on) {
      const r = await git(folder, on, ["rev-parse", "--show-toplevel", "--absolute-git-dir"]).catch(() => ({ code: 1 }));
      const [top, gitDir] = r.code === 0 ? r.stdout.trim().split("\n") : [];
      this.ctx = gitDir ? { folder, on, top, gitDir } : { folder, on, error: true };
      this.raw = null; this.view = null; this.scrollY = 0; this.details.clear();
      if (gitDir && !on) this.watch(gitDir);
      else this.watchGen = (this.watchGen ?? 0) + 1; // stops the old loop at its next event
    }
    if (this.ctx.error) return;
    const r = await git(folder, on, ["log", this.scope === "head" ? "HEAD" : "--all", "--decorate=full", "--topo-order", "--date-order", "-n", String(N),
      "--format=%H%x1f%P%x1f%D%x1f%s%x1f%an%x1f%ct%x1e"]);
    if (r.code !== 0) { this.raw = { error: errLine(r) }; return; }
    const commits = parseLog(r.stdout);
    this.raw = { key: commits.map((c) => c.hash + c.parents.join("")).join(","), commits };
  }

  // ponytail: watches the git dir only (a linked worktree's branch refs live in the common dir; SYNC covers it).
  // Remote machines aren't watched (watchFolder is local only); SYNC refreshes them.
  watch(gitDir) {
    const gen = (this.watchGen = (this.watchGen ?? 0) + 1);
    this.acx.spawn(async () => {
      for (;;) {
        try { await watchFolder(gitDir); } catch { return; }
        if (gen !== this.watchGen) return;
        this.want();
      }
    });
  }

  // Lanes are computed in a queued job (the JS engine is slow), memoized by the commit hashes.
  layout() {
    const raw = this.raw;
    if (!raw?.commits || this.view?.key === raw.key || this.laying === raw.key) return;
    this.laying = raw.key;
    this.acx.timer.after(1, (cx) => {
      if (this.raw !== raw) { this.laying = null; this.layout(); return; }
      const rows = lanes(raw.commits);
      const width = Math.min(MAXL, 1 + Math.max(0, ...rows.flatMap((r) => [r.lane, ...r.edges.map((e) => Math.max(e.fromLane, e.toLane))])));
      this.view = { key: raw.key, rows, width };
      this.laying = null;
      cx.notify();
    });
  }

  setScope(s, cx) {
    if (this.scope === s) return;
    this.scope = s;
    try { localStorage.setItem("scope", s); } catch {}
    this.scrollY = 0;
    this.load(cx);
  }

  copy(hash, cx) {
    cx.write_to_clipboard(hash);
    if (!anim()) return;
    const f = (this.copied = { hash });
    this.acx.timer.after(700, (cx) => { if (this.copied === f) { this.copied = null; cx.notify(); } });
    cx.notify();
  }

  // Hover rested 300ms on a row: open its card and fetch its stat once (cached).
  arm(hash) {
    this.arming = hash;
    this.acx.timer.after(300, (cx) => {
      if (this.arming !== hash) return;
      this.card = hash;
      if (!this.details.has(hash) && this.ctx?.gitDir) {
        const d = {};
        this.details.set(hash, d);
        const { folder, on } = this.ctx;
        cx.spawn(async (cx) => {
          try {
            const r = await git(folder, on, ["show", "--stat", "--format=%H%n%an%n%ae%n%ci%n%P", "-1", hash]);
            if (r.code === 0) d.data = parseShow(r.stdout); else d.error = errLine(r);
          } catch (e) { d.error = String(e?.message ?? e).slice(0, 60); }
          cx.notify();
        });
      }
      cx.notify();
    });
  }

  disarm(hash) {
    if (this.arming === hash) this.arming = null;
    if (this.card === hash) this.card = null;
  }

  render(cx) {
    if (where().folder !== this.lastFolder) { this.lastFolder = where().folder; this.acx.timer.after(50, (cx) => this.load(cx)); }
    const t = theme();
    const root = v_flex().id("graph-root").size_full().min_h(0).bg(t.chrome).px(12).pb(10).text_size(13);
    const msg = (text, color = t.dim) => div().pt(10).font_family(MONO).text_size(11).text_color(color).child(text);
    if (!this.ctx && !this.lastFolder) return root.child(this.header(t, null, null)).child(msg("NO REPO // not a git folder", t.blocked));
    if (this.ctx?.error) return root.child(this.header(t, null, null)).child(msg("NO REPO // not a git folder", t.blocked));
    if (this.raw?.error) return root.child(this.header(t, this.ctx, null)).child(msg(`GIT ERROR // ${this.raw.error}`, t.blocked));
    this.layout();
    const raw = this.raw, view = raw && this.view?.key === raw.key ? this.view : null;
    const head = raw?.commits?.find((c) => c.refs.some((r) => r.kind === "head"));
    const branch = head ? head.refs.find((r) => r.current)?.name ?? "DETACHED" : "?";
    if (!view) return root.child(this.header(t, this.ctx, raw ? branch : null)).child(msg("SCANNING…"));
    if (!raw.commits.length) return root.child(this.header(t, this.ctx, branch)).child(msg("NO COMMITS"));
    return root.child(this.header(t, this.ctx, branch)).child(this.list(t, raw.commits, view));
  }

  // Like the JOBS journal header: dim mono path line, caps chips, square SYNC.
  header(t, ctx, branch) {
    const name = ctx?.top ? ctx.top.split("/").pop() : "—";
    const chip = (id, text, on, click) => div().id(id).flex_none().h(20).px(6).flex().items_center().rounded(0).border(1)
      .border_color(on ? t.accent : t.border).font_family(LABEL).font_weight(600).text_size(10).text_color(on ? t.accent : t.muted)
      .cursor_pointer().hover((s) => s.bg(t.hover).border_color(t.accent).text_color(t.foreground)).on_click(click).child(text);
    return h_flex().h(32).gap(6).items_center().flex_none().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(10).text_color(t.dim).child(`GRAPH // ${name} // ${branch ?? "…"}`))
      .child(h_flex().flex_none().items_center()
        .child(chip("scope-all", "ALL", this.scope !== "head", (_e, cx) => this.setScope("all", cx)))
        .child(div().px(3).font_family(MONO).text_size(10).text_color(t.dim).child("|"))
        .child(chip("scope-head", "HEAD", this.scope === "head", (_e, cx) => this.setScope("head", cx))))
      .child(chip("sync", this.loading ? "SYNC…" : "SYNC", false, (_e, cx) => this.load(cx)));
  }

  // Custom viewport: the wheel moves `scrollY`, and only the rows on screen are built (each keeps its own
  // hover and click). The graph for all visible rows is one path per color on top of them.
  list(t, commits, view) {
    const max = Math.max(0, commits.length * ROW - this.vh);
    this.scrollY = Math.min(Math.max(0, this.scrollY), max);
    const first = Math.floor(this.scrollY / ROW), last = Math.min(commits.length - 1, Math.ceil((this.scrollY + this.vh) / ROW));
    const gw = GX * 2 + view.width * LANE;
    const rows = [];
    for (let i = first; i <= last; i++) rows.push(this.row(t, commits[i], view.rows[i], i, gw));
    const box = div().id("graph-view").relative().flex_1().min_h(0).mt(4).overflow_hidden()
      .on_size_change((size, cx) => { if (size.height !== this.vh) { this.vh = size.height; cx.notify(); } })
      .on_scroll_wheel((e, cx) => {
        const y = Math.min(Math.max(0, this.scrollY - e.delta.y), max);
        if (y !== this.scrollY) { this.scrollY = y; this.arming = null; this.card = null; cx.notify(); }
      })
      .children(rows)
      .children(this.paths(t, commits, view, first, last));
    if (max > 0) {
      const h = Math.max(16, (this.vh * this.vh) / (commits.length * ROW));
      box.child(div().absolute().right(0).w(2).h(h).top((this.scrollY / max) * (this.vh - h)).bg(t.border));
    }
    return box;
  }

  // One stroked path per lane color for the edges, one fill path per color for the commit diamonds, one stroke
  // path per color for hollow merge diamonds, plus the HEAD ring.
  paths(t, commits, view, first, last) {
    const x = (l) => GX + l * LANE + LANE / 2;
    const lines = {}, dots = {}, rings = {};
    const add = (m, c, f) => { m[c] = f(m[c] ?? (m === dots ? PathBuilder.fill() : PathBuilder.stroke(m === lines ? 1.5 : 1))); };
    let head = null, holes = null;
    for (let i = Math.max(0, first - 1); i <= last; i++) {
      const r = view.rows[i], y = i * ROW - this.scrollY + ROW / 2;
      for (const e of r.edges) {
        if (e.fromLane >= MAXL || e.toLane >= MAXL) continue;
        const x1 = x(e.fromLane), x2 = x(e.toLane), y2 = y + ROW, dx = Math.abs(x2 - x1);
        add(lines, e.color % COLORS.length, (p) => {
          p = p.move_to(x1, y);
          // 45°: a join drops straight then slants into the commit; a merge slants out first.
          if (dx && dx <= ROW) p = e.kind === "merge" ? p.line_to(x2, y + dx) : p.line_to(x1, y2 - dx);
          return p.line_to(x2, y2);
        });
      }
      if (i < first || r.lane >= MAXL) continue;
      const cx = x(r.lane), d = 3.5, poly = [[cx, y - d], [cx + d, y], [cx, y + d], [cx - d, y]];
      add(r.merge ? rings : dots, r.color % COLORS.length, (p) => p.add_polygon(poly, true));
      if (r.merge) holes = (holes ?? PathBuilder.fill()).add_polygon(poly, true);
      if (commits[i].refs.some((f) => f.kind === "head")) head = [cx, y];
    }
    const out = [];
    const layer = (path, color) => out.push(W.paint_path(path, color).absolute().top(0).left(0).size_full());
    for (const [c, p] of Object.entries(lines)) layer(p.build(), t[COLORS[c]] ?? t.accent);
    // Merge diamonds are hollow: fill with the chrome color first so lines don't show through.
    if (holes) layer(holes.build(), t.chrome);
    for (const [c, p] of Object.entries(rings)) layer(p.build(), t[COLORS[c]] ?? t.accent);
    for (const [c, p] of Object.entries(dots)) layer(p.build(), t[COLORS[c]] ?? t.accent);
    if (head) {
      let p = PathBuilder.stroke(1).move_to(head[0] + 5, head[1]);
      for (let k = 1; k <= 32; k++) { const a = (k / 32) * Math.PI * 2; p = p.line_to(head[0] + Math.cos(a) * 5, head[1] + Math.sin(a) * 5); }
      layer(p.build(), t.accent);
    }
    return out;
  }

  refChip(t, ref) {
    if (ref.kind === "tag") return div().flex_none().font_family(MONO).text_size(9.5).text_color(t.done).child(`◆ ${ref.name}`);
    if (ref.kind === "remote") return div().flex_none().h(14).px(4).flex().items_center().border(1).border_color(t.dim)
      .font_family(MONO).text_size(9.5).text_color(t.dim).child(ref.name);
    // Local branch (and the HEAD tag): yellow, 4px top-left cut; the current branch adds an accent edge.
    return div().relative().flex_none().h(14).px(5).flex().items_center()
      .child(W.paint_path(notch(4), t.solid).absolute().top(0).left(0).size_full())
      .when(Boolean(ref.current), (el) => el.child(W.paint_path(notchEdge(4), t.accent).absolute().top(0).left(0).size_full()))
      .child(div().relative().font_family(LABEL).font_weight(600).text_size(9.5).text_color(t.solid_foreground)
        .child(ref.kind === "head" ? "HEAD" : ref.name.toUpperCase()));
  }

  row(t, c, r, i, gw) {
    const refs = c.refs.filter((f) => f.kind !== "head");
    const isHead = c.refs.some((f) => f.kind === "head");
    const shown = refs.slice(0, 3);
    const flash = this.copied?.hash === c.hash;
    return h_flex().id(`row-${c.hash}`).absolute().left(0).right(0).top(i * ROW - this.scrollY).h(ROW).pl(gw).pr(6).gap(6).items_center()
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_hover((h) => (h ? this.arm(c.hash) : this.disarm(c.hash)))
      .on_click((_e, cx) => this.copy(c.hash, cx))
      // Chips give way first (clipped), so the subject keeps at least 80px.
      .when(isHead || shown.length > 0, (el) => el.child(h_flex().flex_none().gap(6).items_center()
        .when(isHead, (el) => el.child(this.refChip(t, { kind: "head" })))
        .children(shown.map((f) => this.refChip(t, f)))
        .when(refs.length > shown.length, (el) => el.child(div().flex_none().font_family(MONO).text_size(9).text_color(t.dim).child(`+${refs.length - shown.length}`)))))
      .child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child(c.hash.slice(0, 7)))
      .child(div().flex_1().min_w(40).truncate().font_family("Rajdhani").text_size(12.5).text_color(t.foreground).child(c.subject))
      .child(flash
        ? div().flex_none().h(14).px(5).flex().items_center().bg(t.solid).font_family(LABEL).font_weight(600).text_size(9.5).text_color(t.solid_foreground).child("COPIED")
        : div().flex_none().font_family(MONO).text_size(9.5).text_color(t.dim).child(`${c.author.split(/\s+/)[0]} · ${ago(Date.now() - c.time)}`))
      .when(this.card === c.hash, (el) => el.child(Popup.new(`card-${c.hash}`, div().size(1))
        .absolute().top(0).left(-10).anchor("top_right").content(this.cardView(t, c))));
  }

  // Scan-style card (cyberneon-agents' look): accent cut edge, brackets, label/value lines.
  cardView(t, c) {
    const d = this.details.get(c.hash) ?? {};
    const line = (k, v, color = t.foreground) => h_flex().h(16).gap(10).items_center()
      .child(div().flex_none().w(56).font_family(LABEL).font_weight(600).text_size(9).text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).truncate().text_right().font_family(MONO).text_size(10).text_color(color).child(v));
    const bk = (v, h) => {
      let el = div().absolute().size(8).border_color(t.accent);
      el = v === "top" ? el.top(4).border_t(1) : el.bottom(4).border_b(1);
      return h === "left" ? el.left(4).border_l(1) : el.right(4).border_r(1);
    };
    const s = d.data;
    const date = s?.date ?? new Date(c.time).toISOString().replace("T", " ").slice(0, 19);
    return v_flex().id("commit-card").relative().w(320).px(14).pt(10).pb(12).gap(2).overflow_hidden()
      .child(W.paint_path(notch(10), t.accent).absolute().top(0).left(0).size_full())
      .child(W.paint_path(notch(9), t.raised).absolute().top(1).left(1).right(1).bottom(1))
      .child(bk("top", "right")).child(bk("bottom", "left")).child(bk("bottom", "right"))
      .child(div().relative().font_family(MONO).text_size(9).text_color(t.accent).child(`COMMIT // ${c.hash.slice(0, 7)}`))
      .child(div().relative().pb(6).truncate().font_weight(700).text_size(14).text_color(t.foreground).child(c.subject))
      .child(v_flex().relative().gap(1)
        .child(line("HASH", c.hash))
        .child(line("AUTHOR", s?.author ?? c.author))
        .child(line("DATE", date))
        .child(line("PARENTS", (s?.parents ?? c.parents).map((p) => p.slice(0, 7)).join(" ") || "—"))
        .child(d.error ? line("CHANGES", `GIT ERROR // ${d.error}`, t.blocked)
          : s ? line("CHANGES", `${s.files} files changed, +${s.add} −${s.del}`)
          : line("CHANGES", "SCANNING…", t.dim)));
  }
}
