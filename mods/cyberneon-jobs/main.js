import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, panes, spaces, exec, shared, setShared, theme, run } from "herdr";
import { tasks, prObjectives, prRisk, issueRisk, milestoneRisk, plain } from "./rules.js";

// Quest tracker driven by GitHub, read-only through `gh`. Two copies (role "hud" floats over
// `main`, role "journal" sits in the panel); both read one shared cache, one fetch runs at a time.
const MONO = "Share Tech Mono";
const LABEL = "Chakra Petch";
const W = globalThis.window; // herdr's window() shadows the paint_path host
const TTL = 120_000, ERR_TTL = 300_000, LOCK_TTL = 90_000, BODY_TTL = 600_000, MAX = 30;
const LOCK = "cyberneon.jobs.fetching";
// The person's HUD choice: "full" (default), "mini" (one line) or "off". Global, not per repo.
const HUD = "cyberneon.jobs.hud";
const hudMode = () => shared(HUD) ?? "full";
const anim = () => shared("cyberneon.animations") !== false;
const cacheKey = (repo) => `cyberneon.jobs.cache.${repo}`;
const pickKey = (repo) => `cyberneon.jobs.milestone.${repo}`;
const trackKey = (repo) => `cyberneon.jobs.tracked.${repo}`;
const selKey = (repo) => `cyberneon.jobs.selected.${repo}`;
const bodyKey = (repo, n) => `cyberneon.jobs.body.${repo}#${n}`;
const ago = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)}S` : `${Math.round(ms / 60_000)}M`) + " AGO";
const same = (a, b) => a && b && a.kind === b.kind && a.number === b.number;
const cut = (c) => PathBuilder.fill().add_polygon([[c, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, c]], true).build();

// The repo folder: the focused pane's, else the active space's.
function where() {
  const space = spaces().find((s) => s.active);
  return { folder: panes().find((p) => p.focused)?.cwd || space?.folder || null, on: space?.machine ?? null };
}

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
  return r;
}
const json = async (args, cwd, on) => {
  const r = await gh(args, cwd, on);
  if (r.code !== 0) throw new Error(reason(r));
  return JSON.parse(r.stdout || "null");
};
const issueOf = (i) => ({ number: i.number, title: i.title, url: i.url, state: i.state ?? "OPEN", milestone: i.milestone?.title ?? null,
  labels: (i.labels ?? []).map((l) => l.name), createdAt: i.createdAt });

// The one fetch. Strictly GET: pr view, issue list, api (default GET).
async function fetchAll(repo, branch, folder, on) {
  const prRes = await gh(["pr", "view", "--json", "number,title,url,state,isDraft,reviewDecision,statusCheckRollup,body"], folder, on);
  let pr = null;
  if (prRes.code === 0) {
    const p = JSON.parse(prRes.stdout);
    pr = { number: p.number, title: p.title, url: p.url, state: p.state, isDraft: p.isDraft, reviewDecision: p.reviewDecision,
      body: p.body ?? "", objectives: prObjectives(p) };
  } else if (!/no (open )?pull requests? found/i.test(prRes.stderr)) throw new Error(reason(prRes));
  const issues = (await json(["issue", "list", "--assignee", "@me", "--state", "open", "--json", "number,title,url,milestone,labels,createdAt", "--limit", "50"], folder, on)).map(issueOf);
  const milestones = (await json(["api", `repos/${repo}/milestones?state=open`], folder, on))
    .map((m) => ({ number: m.number, title: m.title, url: m.html_url, due_on: m.due_on, open_issues: m.open_issues, description: m.description ?? "" }));
  const picked = shared(pickKey(repo));
  const ms = milestones.find((m) => m.number === picked) ?? milestones[0] ?? null;
  const milestoneIssues = ms
    ? (await json(["issue", "list", "--milestone", ms.title, "--state", "all", "--json", "number,title,state,url,labels,createdAt", "--limit", "50"], folder, on)).map(issueOf)
    : [];
  return { at: Date.now(), branch, milestone: ms?.number ?? null, pr, issues, milestones, milestoneIssues };
}

// Jobs per section. GIGS = open milestone issues not in SIDE JOBS.
// ponytail: "mine" = the 50 assigned issues we fetched; a 51st assigned issue would show as a gig.
function sections(cache) {
  const ms = cache.milestones?.find((m) => m.number === cache.milestone);
  const mine = new Set((cache.issues ?? []).map((i) => i.number));
  const issueJob = (i) => ({ kind: "issue", number: i.number, title: i.title, url: i.url, code: "IS", glyph: "open", risk: issueRisk(i) });
  const main = [];
  const pr = cache.pr;
  if (pr) main.push({ kind: "pr", number: pr.number, title: pr.title, url: pr.url, code: "PR", pr, risk: prRisk(pr),
    glyph: pr.state === "MERGED" ? "merged" : pr.isDraft ? "draft" : "open" });
  if (ms) main.push({ kind: "milestone", number: ms.number, title: ms.title, url: ms.url, code: "MS", ms, risk: milestoneRisk(ms), glyph: "open" });
  return {
    main,
    side: (cache.issues ?? []).map(issueJob),
    gigs: (cache.milestoneIssues ?? []).filter((i) => i.state === "OPEN" && !mine.has(i.number)).map(issueJob),
  };
}
const findJob = (secs, ref) => ref ? [...secs.main, ...secs.side, ...secs.gigs].find((j) => same(j, ref)) ?? null : null;

export default class Jobs extends View {
  init(_props, cx) {
    this.acx = cx; // render's cx dies with the call; timers come from here
    this.role = props()?.role;
    this.ctx = null; // { folder, on, repo, branch } or { folder, repo: null }
    this.lastFolder = undefined;
    this.pickOpen = false;
    this.wide = false;
    try { this.closed = JSON.parse(localStorage.getItem("closed") ?? "{}"); } catch { this.closed = {}; }
    this.seen = new Map(); // HUD: objective key → last state
    this.flick = new Map(); // HUD: key → { gen, dim }
    this.gen = 0;
    cx.timer.every(15_000, (cx) => this.tick(cx));
    this.tick(cx);
  }

  tick(cx, force = false) {
    cx.spawn(async (cx) => {
      await this.refresh(force).catch(() => {});
      cx.notify();
    });
  }

  async refresh(force) {
    const { folder, on } = where();
    this.lastFolder = folder;
    if (!folder) { this.ctx = null; return; }
    const git = (args) => exec("git", ["-C", folder, ...args], { on, timeout: 5000 }).catch(() => ({ code: 1, stdout: "" }));
    // Read-only git: remote URL and current branch.
    if (this.ctx?.folder !== folder) {
      const r = await git(["remote", "get-url", "origin"]);
      this.ctx = { folder, on, repo: r.code === 0 ? parseRemote(r.stdout) : null, branch: null };
    }
    if (!this.ctx.repo) return;
    const b = await git(["rev-parse", "--abbrev-ref", "HEAD"]);
    this.ctx.branch = b.stdout.trim() || null;
    const { repo, branch } = this.ctx;
    const cache = shared(cacheKey(repo));
    const age = Date.now() - (cache?.at ?? 0);
    const picked = shared(pickKey(repo));
    const stale = force || !cache || cache.branch !== branch || age > (cache.error ? ERR_TTL : TTL)
      || (!cache.error && picked != null && picked !== cache.milestone);
    if (!stale) return;
    if (cache?.error && !force && cache.branch === branch && age < ERR_TTL) return; // gh errors: no retry before 5 min
    const lock = shared(LOCK);
    if (lock && Date.now() - lock.at < LOCK_TTL) return; // another copy is fetching (stale locks expire)
    setShared(LOCK, { repo, at: Date.now() });
    try {
      setShared(cacheKey(repo), await fetchAll(repo, branch, folder, on));
    } catch (e) {
      setShared(cacheKey(repo), { ...(cache ?? {}), at: Date.now(), branch, error: e.message || String(e) });
    } finally {
      setShared(LOCK, null);
    }
  }

  // Issue body: fetched on select (or when the HUD tracks it), cached in shared state, at most every 10 min.
  // PR body comes with the main fetch and milestone text with the milestones call, so neither needs this.
  wantBody(repo, job) {
    if (job?.kind !== "issue") return;
    const b = shared(bodyKey(repo, job.number));
    if ((b?.loading && Date.now() - b.loading < 30_000) || (b?.at && Date.now() - b.at < BODY_TTL)) return;
    this.acx.timer.after(1, (cx) => {
      const k = bodyKey(repo, job.number), cur = shared(k);
      if ((cur?.loading && Date.now() - cur.loading < 30_000) || (cur?.at && Date.now() - cur.at < BODY_TTL)) return;
      setShared(k, { ...(cur ?? {}), loading: Date.now() });
      const { folder, on } = this.ctx;
      cx.spawn(async () => {
        try { setShared(k, { at: Date.now(), body: (await json(["issue", "view", String(job.number), "--json", "body"], folder, on))?.body ?? "" }); }
        catch (e) { setShared(k, { at: Date.now(), body: cur?.body ?? null, error: e.message || String(e) }); }
      });
    });
  }

  objectivesOf(repo, cache, job) {
    if (job.kind === "pr") return job.pr.objectives;
    if (job.kind === "milestone") return (cache.milestoneIssues ?? []).filter((i) => i.state === "OPEN")
      .map((i) => ({ key: `ms:${i.number}`, text: `#${i.number} ${i.title}`, state: "open" }));
    const list = tasks(shared(bodyKey(repo, job.number))?.body);
    return list.length ? list : [{ key: "close", text: `Close #${job.number}`, state: "open" }];
  }

  // Tracked job ref. Unset → the branch's PR; null (UNTRACK) → nothing.
  tracked(repo, cache) {
    const v = shared(trackKey(repo));
    return v === undefined ? (cache.pr ? { kind: "pr", number: cache.pr.number } : null) : v;
  }

  open(url, cx) {
    if (!url) return;
    if (cx.open_url) cx.open_url(url);
    else exec("open", [url]);
  }

  // HUD: one short flicker when an objective turns done. Two one-shot timers flip a target;
  // `.transition("opacity")` does the motion.
  watch(list) {
    for (const o of list) {
      const was = this.seen.get(o.key);
      this.seen.set(o.key, o.state);
      if (was && was !== "done" && o.state === "done" && anim()) {
        const f = { gen: ++this.gen, dim: false };
        this.flick.set(o.key, f);
        this.acx.timer.after(30, (cx) => { f.dim = true; cx.notify(); });
        this.acx.timer.after(130, (cx) => { f.dim = false; cx.notify(); });
        this.acx.timer.after(900, (cx) => { if (this.flick.get(o.key) === f) { this.flick.delete(o.key); cx.notify(); } });
      }
    }
  }

  render() {
    // Folder changed (focus moved, space switched): look now instead of waiting for the timer.
    if (where().folder !== this.lastFolder) { this.lastFolder = where().folder; this.acx.timer.after(50, (cx) => this.tick(cx)); }
    const t = theme();
    const repo = this.ctx?.repo;
    const cache = repo ? shared(cacheKey(repo)) : null;
    return this.role === "hud" ? this.hud(t, repo, cache) : this.journal(t, repo, cache);
  }

  square(t, state) {
    const sq = div().size(8).flex_none().rounded(0);
    return state === "done" ? sq.bg(t.done) : state === "blocked" ? sq.bg(t.blocked) : sq.border(1).border_color(t.muted);
  }

  tag(t, text) {
    return div().flex_none().h(16).px(6).flex().items_center().bg(t.solid).text_color(t.solid_foreground)
      .font_family(LABEL).font_weight(600).text_size(10.5).child(text);
  }

  // Small square HUD button; stops the click so the card's own click (open journal) doesn't fire.
  hudButton(t, id, glyph, mode) {
    return div().id(id).size(16).flex_none().flex().items_center().justify_center().rounded(0)
      .border(1).border_color(t.border).font_family(MONO).text_size(11).text_color(t.muted)
      .hover((s) => s.bg(t.hover).border_color(t.accent).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); setShared(HUD, mode); })
      .child(glyph);
  }

  hud(t, repo, cache) {
    const mode = hudMode();
    if (mode === "off" || !cache || cache.error) return div();
    const secs = sections(cache);
    // Tracked job, else today's fallback: the PR, else the milestone.
    const job = findJob(secs, this.tracked(repo, cache)) ?? secs.main[0];
    if (!job) return div();
    this.wantBody(repo, job);
    const list = this.objectivesOf(repo, cache, job);
    const mi = cache.milestoneIssues ?? [];
    const head = job.kind === "milestone"
      ? { tag: "MILESTONE", id: `${mi.filter((i) => i.state === "CLOSED").length}/${mi.length}` }
      : { tag: job.kind === "pr" ? "JOB" : "SIDE JOB", id: `#${job.number}` };
    this.watch(list);
    const open = list.filter((o) => o.state !== "done" || this.flick.has(o.key));
    // Minimized: one line, click to expand.
    if (mode === "mini") return h_flex().id("hud-mini").gap(6).items_center().px(8).py(4).cursor_pointer()
      .on_click(() => setShared(HUD, "full"))
      .child(this.tag(t, head.tag))
      .child(div().font_family(MONO).text_size(11).text_color(t.muted).child(head.id))
      .child(div().font_family(MONO).text_size(11).text_color(open.some((o) => o.state === "blocked") ? t.blocked : t.foreground)
        .child(`▸ ${open.length}`))
      .child(this.hudButton(t, "hud-close", "×", "off"));
    const shown = open.slice(0, 3);
    const more = open.length - shown.length;
    return v_flex().id("hud").max_w(300).min_w(200).px(10).py(6).gap(4).cursor_pointer()
      .on_click(() => {
        setShared(selKey(repo), { kind: job.kind, number: job.number });
        run("layout.select", { stack: "panel-body", child: "jobs" }); run("layout.show", { id: "panel" });
      })
      .child(h_flex().gap(6).items_center()
        .child(this.tag(t, head.tag))
        .child(div().flex_1().font_family(MONO).text_size(11).text_color(t.muted).child(head.id))
        .child(this.hudButton(t, "hud-min", "–", "mini"))
        .child(this.hudButton(t, "hud-close", "×", "off")))
      .child(div().truncate().font_family("Rajdhani").font_weight(700).text_size(14).text_color(t.foreground).child(job.title))
      .children(shown.map((o) => {
        const f = this.flick.get(o.key);
        return h_flex().id(`o-${o.key}-${f?.gen ?? 0}`).gap(6).items_center().min_w(0)
          .when(Boolean(f), (el) => el.transition("opacity", { duration: 60, easing: "linear" }).opacity(f.dim ? 0.15 : 1))
          .child(this.square(t, o.state))
          .child(div().truncate().text_size(12).text_color(o.state === "blocked" ? t.blocked : t.foreground).child(o.text));
      }))
      .when(more > 0, (el) => el.child(div().font_family(MONO).text_size(10).text_color(t.dim).child(`+${more} MORE`)));
  }

  // Red section bar: accent edge + 12% accent fill, top-left 6px cut, chevron toggles (saved per copy).
  bar(t, key, title, count) {
    const open = !this.closed[key];
    return div().id(`sec-${key}`).relative().h(22).flex_none().cursor_pointer()
      .on_click((_e, cx) => {
        this.closed[key] = open;
        try { localStorage.setItem("closed", JSON.stringify(this.closed)); } catch {}
        cx.notify();
      })
      .child(W.paint_path(cut(6), t.accent).absolute().top(0).left(0).size_full())
      .child(W.paint_path(cut(5), t.chrome).absolute().top(1).left(1).right(1).bottom(1))
      .child(W.paint_path(cut(5), `${t.accent}1f`).absolute().top(1).left(1).right(1).bottom(1))
      .child(h_flex().relative().size_full().pl(10).pr(8).gap(6).items_center()
        .child(div().flex_none().font_family(LABEL).font_weight(600).text_size(11).text_color(t.accent).child(title))
        .child(div().flex_1().min_w(0).font_family(MONO).text_size(10).text_color(t.muted).child(String(count).padStart(2, "0")))
        .child(div().flex_none().text_size(11).text_color(t.accent).child(open ? "▽" : "▷")));
  }

  emblem(t, job) {
    const g = div().absolute().right(2).bottom(2).size(5);
    return div().relative().size(30).flex_none().bg(t.raised).border(1).border_color(t.muted)
      .flex().items_center().justify_center().font_family(MONO).text_size(11).text_color(t.foreground).child(job.code)
      .child(job.glyph === "merged" ? g.bg(t.done) : job.glyph === "draft" ? g.border(1).border_color(t.dim) : g.bg(t.working));
  }

  trackIcon(t) {
    return div().size(10).flex_none().border(1).border_color(t.solid).p(2).child(div().size_full().bg(t.solid));
  }

  card(t, repo, job, sel, tracked) {
    const on = same(job, sel);
    return h_flex().id(`job-${job.kind}-${job.number}`).relative().h(46).flex_none().pl(8).pr(8).gap(8).items_center().rounded(0)
      .border(1).border_color(on ? t.accent : t.border).cursor_pointer()
      .when(on, (el) => el.bg(t.selected)).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => setShared(selKey(repo), { kind: job.kind, number: job.number }))
      .when(same(job, tracked), (el) => el.child(div().absolute().left(0).top(0).bottom(0).w(4).bg(t.solid)))
      .child(this.emblem(t, job))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().font_family("Rajdhani").font_weight(600).text_size(13).text_color(t.working).child(job.title))
        // Second line: the id (#167 for issues and PRs, M3 for a milestone), then the risk.
        .child(h_flex().gap(6).min_w(0).font_family(MONO).text_size(9.5)
          .child(div().flex_none().text_color(t.foreground).child(job.kind === "milestone" ? `M${job.number}` : `#${job.number}`))
          .child(div().flex_none().text_color(t.dim).child("·"))
          .child(div().truncate().text_color(job.risk === "VERY HIGH" ? t.blocked : t.accent).child(`RISK: ${job.risk}`))))
      .when(same(job, tracked), (el) => el.child(this.trackIcon(t)));
  }

  empty(t, text) {
    return div().px(4).py(4).font_family(MONO).text_size(11).text_color(t.dim).child(text);
  }

  // One section: bar, then (when open) up to MAX cards and `+n MORE` (opens the repo's issue list).
  group(t, repo, key, title, jobs, sel, tracked, extra = [], none = "NONE") {
    const out = [this.bar(t, key, title, jobs.length)];
    if (this.closed[key]) return out;
    out.push(...jobs.slice(0, MAX).map((j) => this.card(t, repo, j, sel, tracked)));
    if (jobs.length > MAX) out.push(div().id(`more-${key}`).h(18).px(4).cursor_pointer().font_family(MONO).text_size(10).text_color(t.dim)
      .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => this.open(`https://github.com/${repo}/issues`, cx)).child(`+${jobs.length - MAX} MORE`));
    if (!jobs.length) out.push(this.empty(t, none));
    return out.concat(extra);
  }

  picker(t, repo, cache) {
    const ms = cache.milestones?.find((m) => m.number === cache.milestone);
    const head = h_flex().id("ms-pick").h(22).px(6).gap(6).items_center().rounded(0).cursor_pointer()
      .border(1).border_color(this.pickOpen ? t.accent : t.border).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.pickOpen = !this.pickOpen; cx.notify(); })
      .child(div().flex_none().font_family(MONO).text_size(9).text_color(t.dim).child("MILESTONE //"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(ms?.title ?? "NO OPEN MILESTONE"))
      .child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child(this.pickOpen ? "▴" : "▾"));
    const options = this.pickOpen ? (cache.milestones ?? []).map((m) =>
      h_flex().id(`ms-${m.number}`).h(22).pl(12).pr(4).gap(6).items_center().cursor_pointer().hover((s) => s.bg(t.hover))
        .child(div().size(6).flex_none().when(m.number === cache.milestone, (el) => el.bg(t.accent)).when(m.number !== cache.milestone, (el) => el.border(1).border_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(m.number === cache.milestone ? t.foreground : t.muted).child(m.title))
        .on_click((_e, cx) => { this.pickOpen = false; setShared(pickKey(repo), m.number); this.tick(cx); })) : [];
    return [head, ...options];
  }

  button(t, id, text, hot, onClick) {
    return div().id(id).h(22).px(10).flex().items_center().flex_none().rounded(0).border(1).border_color(hot ? t.solid : t.border)
      .font_family(LABEL).font_weight(600).text_size(10.5).text_color(hot ? t.solid : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).border_color(t.accent).text_color(t.foreground)).on_click(onClick).child(text);
  }

  details(t, repo, cache, job, tracked, back) {
    const isTracked = same(job, tracked);
    this.wantBody(repo, job);
    const b = job.kind === "issue" ? shared(bodyKey(repo, job.number)) : null;
    const body = job.kind === "pr" ? job.pr.body : job.kind === "milestone" ? job.ms.description : b?.body;
    const lines = body == null ? [] : plain(body).split("\n");
    const label = (text) => div().flex_none().pt(4).font_family(MONO).text_size(9).text_color(t.dim).child(text);
    const corner = (el) => el.absolute().size(8).border_color(t.accent);
    return v_flex().id("details").relative().flex_1().min_w(0).min_h(0).px(12).py(10).gap(6)
      .child(corner(div().top(0).left(0).border_t(1).border_l(1)))
      .child(corner(div().top(0).right(0).border_t(1).border_r(1)))
      .child(corner(div().bottom(0).left(0).border_b(1).border_l(1)))
      .child(corner(div().bottom(0).right(0).border_b(1).border_r(1)))
      .when(back, (el) => el.child(h_flex().child(this.button(t, "back", "◂ BACK", false, () => setShared(selKey(repo), null)))))
      .child(div().flex_none().font_family(MONO).text_size(9).text_color(t.dim).child(`${job.code} // JOB // #${job.number}`))
      .child(div().flex_none().max_h(54).overflow_hidden().font_family("Rajdhani").font_weight(700).text_size(18).text_color(t.foreground).child(job.title))
      .child(v_flex().id("detail-scroll").flex_1().min_h(0).overflow_y_scrollbar().gap(4)
        .child(label("//01 OBJECTIVES"))
        .children(this.objectivesOf(repo, cache, job).map((o) => h_flex().gap(8).items_start()
          .child(div().relative().size(9).mt(4).flex_none().child(W.paint_path(cut(4), t.solid).absolute().top(0).left(0).size_full()))
          .child(div().flex_1().min_w(0).text_size(12.5)
            .text_color(o.state === "done" ? t.dim : o.state === "blocked" ? t.blocked : t.foreground)
            .when(o.state === "done", (el) => el.line_through()).child(o.text))))
        .child(label("//02 BRIEFING"))
        .when(body == null, (el) => el.child(div().font_family(MONO).text_size(11).text_color(t.dim).child(b?.error ? `NO UPLINK // ${b.error}` : "DECRYPTING…")))
        .when(body != null && !lines.join("").trim(), (el) => el.child(div().font_family(MONO).text_size(11).text_color(t.dim).child("NO BRIEFING")))
        .children(lines.map((l) => (l.trim() ? div().text_size(12.5).text_color(t.muted).child(l) : div().h(6)))))
      .child(h_flex().flex_none().gap(6).pt(4)
        .child(this.button(t, "track", isTracked ? "UNTRACK" : "TRACK", !isTracked,
          () => setShared(trackKey(repo), isTracked ? null : { kind: job.kind, number: job.number })))
        .child(this.button(t, "open", "OPEN", false, (_e, cx) => this.open(job.url, cx))));
  }

  journal(t, repo, cache) {
    const root = v_flex().id("root").size_full().min_h(0).bg(t.chrome).px(12).pb(10).text_size(13)
      .on_size_change((size, cx) => {
        const w = size.width >= 560, changed = w !== this.wide || (w && size.width !== this.width);
        this.wide = w; this.width = size.width;
        if (changed) cx.notify();
      });
    if (!repo) return root.child(div().pt(10).font_family(MONO).text_size(11).text_color(t.blocked).child("NO UPLINK // not a GitHub repo"));
    const header = h_flex().h(32).gap(8).items_center().flex_none().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().font_family(MONO).text_size(10).text_color(t.dim)
        .child(`${repo} // ${this.ctx.branch ?? "?"} // ${cache?.at ? ago(Date.now() - cache.at) : "SYNCING"}`))
      .child(div().id("sync").flex_none().h(20).px(6).flex().items_center().rounded(0).border(1).border_color(t.border)
        .font_family(LABEL).font_weight(600).text_size(10).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover).border_color(t.accent).text_color(t.foreground))
        .on_click((_e, cx) => { this.tick(cx, true); }).child(shared(LOCK) ? "SYNC…" : "SYNC"))
      // Brings the top-right card back after × (lit while the card is shown).
      .child(div().id("hud-toggle").flex_none().h(20).px(6).flex().items_center().rounded(0).border(1)
        .border_color(hudMode() === "off" ? t.border : t.accent)
        .font_family(LABEL).font_weight(600).text_size(10).text_color(hudMode() === "off" ? t.muted : t.accent).cursor_pointer()
        .hover((s) => s.bg(t.hover).border_color(t.accent).text_color(t.foreground))
        .on_click(() => setShared(HUD, hudMode() === "off" ? "full" : "off")).child("HUD"));
    if (cache?.error) return root.child(header).child(div().pt(10).font_family(MONO).text_size(11).text_color(t.blocked).child(`NO UPLINK // ${cache.error}`));
    if (!cache?.at) return root.child(header).child(this.empty(t, "SYNCING…"));

    const secs = sections(cache);
    const tracked = this.tracked(repo, cache);
    // Wide: something is always selected (tracked, else first). Narrow: no selection = the list.
    let job = findJob(secs, shared(selKey(repo)));
    if (!job && this.wide) job = findJob(secs, tracked) ?? [...secs.main, ...secs.side, ...secs.gigs][0] ?? null;
    const sel = job && { kind: job.kind, number: job.number };

    const list = v_flex().id("jobs-scroll").min_h(0).overflow_y_scrollbar().gap(4).pt(8).pr(this.wide ? 10 : 0)
      .children(this.group(t, repo, "main", "MAIN JOBS", secs.main, sel, tracked, this.picker(t, repo, cache), "NO PR // NO MILESTONE"))
      .children(this.group(t, repo, "side", "SIDE JOBS", secs.side, sel, tracked, [], "NO ASSIGNED ISSUES"))
      .children(this.group(t, repo, "gigs", "GIGS", secs.gigs, sel, tracked, [], "NO OPEN GIGS"));

    if (this.wide) {
      return root.child(header).child(h_flex().flex_1().min_h(0).items_start()
        .child(list.w(Math.round((this.width - 24) * 0.42)).flex_none().h_full()) // "42%" lays out much narrower
        .child(div().w(1).h_full().flex_none().bg(t.accent))
        .child(v_flex().flex_1().min_w(0).h_full().pl(10).pt(8)
          .child(job ? this.details(t, repo, cache, job, tracked, false) : this.empty(t, "NO JOBS"))));
    }
    if (job) return root.child(header).child(v_flex().flex_1().min_h(0).pt(8).child(this.details(t, repo, cache, job, tracked, true)));
    return root.child(header).child(list.flex_1());
  }
}
