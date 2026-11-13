import { View, div, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { props, panes, spaces, agents, terminals, knownAgents, exec, shared, setShared, theme, run } from "herdr";
import { tasks, prObjectives, prRisk, issueRisk, milestoneRisk, msInfo, plain, issueBranch, branchIssue, milestoneBranch, branchMilestone, issuePRs, yoloArgv } from "./rules.js";

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
// DISPATCH starts the picked agent (Herdr's knownAgents(): programs.json entries with `run`, installed here)
// in the issue's worktree, with the issue as its first message. Fallback when the list can't be read:
const DEPLOY_ARGV = ["claude"];
const AGENT_PICK = "cyberneon.jobs.agent"; // the picked agent's key, remembered across repos
const YOLO_ON = "cyberneon.jobs.yolo"; // the YOLO checkbox: start the agent with its skip-permission flag
const sleep = (sec) => exec("sleep", [String(sec)]).catch(() => null); // mods have no setTimeout
const WORD = { working: "EXEC", blocked: "INPUT REQ", done: "COMPLETE", idle: "IDLE" };
const DESC_LINES = 5; // milestone card: description lines shown
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
  labels: (i.labels ?? []).map((l) => l.name), tags: (i.labels ?? []).map((l) => ({ name: l.name, color: `#${l.color ?? "888888"}` })), createdAt: i.createdAt, assignees: (i.assignees ?? []).map((a) => a.login) });

// The one fetch. Strictly GET: pr view, issue list, api (default GET).
async function fetchAll(repo, branch, folder, on) {
  const prRes = await gh(["pr", "view", "--json", "number,title,url,state,isDraft,reviewDecision,statusCheckRollup,body"], folder, on);
  let pr = null;
  if (prRes.code === 0) {
    const p = JSON.parse(prRes.stdout);
    pr = { number: p.number, title: p.title, url: p.url, state: p.state, isDraft: p.isDraft, reviewDecision: p.reviewDecision,
      body: p.body ?? "", objectives: prObjectives(p) };
  } else if (!/no (open )?pull requests? found/i.test(prRes.stderr)) throw new Error(reason(prRes));
  // Side jobs: open issues with no milestone (anyone's).
  const issues = (await json(["issue", "list", "--search", "no:milestone", "--state", "open", "--json", "number,title,url,milestone,labels,createdAt,assignees", "--limit", "50"], folder, on)).map(issueOf);
  const milestones = (await json(["api", `repos/${repo}/milestones?state=open`], folder, on))
    .map((m) => ({ number: m.number, title: m.title, url: m.html_url, due_on: m.due_on, open_issues: m.open_issues, closed_issues: m.closed_issues, creator: m.creator?.login ?? null, description: m.description ?? "" }));
  const picked = shared(pickKey(repo));
  const ms = milestones.find((m) => m.number === picked) ?? milestones[0] ?? null;
  const milestoneIssues = ms
    ? (await json(["issue", "list", "--milestone", ms.title, "--state", "all", "--json", "number,title,state,url,labels,createdAt,assignees", "--limit", "50"], folder, on)).map(issueOf)
    : [];
  // Open PRs, to mark issues waiting on review (`PR #12`). Read-only like the rest.
  const prs = await json(["pr", "list", "--state", "open", "--json", "number,headRefName,isDraft", "--limit", "100"], folder, on).catch(() => []);
  return { at: Date.now(), branch, milestone: ms?.number ?? null, pr, issues, milestones, milestoneIssues, prs };
}

// Jobs per section. MAIN JOBS = the branch's PR, the selected milestone and every open issue in it (main quests,
// anyone's). SIDE JOBS = open issues with no milestone. Issues in other milestones show when you pick that milestone.
function sections(cache) {
  const ms = cache.milestones?.find((m) => m.number === cache.milestone);
  const prOf = issuePRs(cache.prs);
  const issueJob = (i) => ({ kind: "issue", number: i.number, title: i.title, url: i.url, code: "IS", glyph: "open", risk: issueRisk(i), assignees: i.assignees, tags: i.tags, openPR: prOf.get(i.number), main: Boolean(i.milestone) || (cache.milestoneIssues ?? []).some((m) => m.number === i.number) });
  const main = [];
  const pr = cache.pr;
  if (pr) main.push({ kind: "pr", number: pr.number, title: pr.title, url: pr.url, code: "PR", pr, risk: prRisk(pr),
    glyph: pr.state === "MERGED" ? "merged" : pr.isDraft ? "draft" : "open" });
  if (ms) main.push({ kind: "milestone", number: ms.number, title: ms.title, url: ms.url, code: "MS", ms, risk: milestoneRisk(ms), glyph: "open",
    // GitHub milestones have no assignees: show the open issues' assignees as its crew, most issues first.
    crew: Object.entries((cache.milestoneIssues ?? []).filter((i) => i.state === "OPEN").flatMap((i) => i.assignees ?? [])
      .reduce((n, a) => ({ ...n, [a]: (n[a] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).map(([a]) => a) });
  return {
    main: [...main, ...(cache.milestoneIssues ?? []).filter((i) => i.state === "OPEN").map(issueJob)],
    side: (cache.issues ?? []).filter((i) => !i.milestone).map(issueJob),
  };
}
const findJob = (secs, ref) => ref ? [...secs.main, ...secs.side].find((j) => same(j, ref)) ?? null : null;

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
      // Where this repo's checkouts live: the main folder, and the worktree mod's ~/.herdr/worktrees/<repo>.
      const c = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      const main = c.code === 0 && c.stdout.trim() ? c.stdout.trim().replace(/\/\.git$/, "") : folder;
      const h = await exec("sh", ["-c", 'printf %s "$HOME"'], { on }).catch(() => null);
      this.ctx.main = main;
      this.ctx.wt = h?.code === 0 && h.stdout ? `${h.stdout}/.herdr/worktrees/${main.split("/").pop()}` : null;
      this.known = await knownAgents({ on }).then((l) => l.filter((a) => a.installed)).catch(() => null);
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

  // An agent pane in this repo (main checkout or its worktrees) whose branch `of()` maps to n.
  paneAgent(of, n) {
    const roots = [this.ctx?.main, this.ctx?.wt].filter(Boolean);
    const p = panes().find((p) => p.status && p.cwd && of(p.branch) === n && roots.some((r) => p.cwd === r || p.cwd.startsWith(`${r}/`)));
    return p ? agents().find((a) => a.pane === p.pane) ?? null : null;
  }

  // A milestone's lead: an agent pane on its milestone-<n> branch, or in its milestone-<n>-… worktree folder
  // whatever branch that checkout is on now (a lead may switch it to work on an issue there).
  leadFor(n) {
    const byBranch = this.paneAgent(branchMilestone, n);
    if (byBranch) return byBranch;
    const wt = this.ctx?.wt;
    const p = wt && panes().find((p) => p.status && p.cwd?.startsWith(`${wt}/`) && branchMilestone(p.cwd.slice(wt.length + 1).split("/")[0]) === n);
    return p ? agents().find((a) => a.pane === p.pane) ?? null : null;
  }

  // The agent working on issue n: a pane on an issue-n branch, else a background terminal in an issue-n
  // worktree folder (an `hc run --bg` someone started there by hand).
  agentFor(n) {
    const p = this.paneAgent(branchIssue, n);
    if (p) return p;
    const sub = (x) => ({ status: x.status ?? "idle", address: x.address, peek: true, space_name: "SUBAGENT", tab_name: x.name ?? x.address });
    // No pane: a background sub-agent (`hc run --bg`) started in one of this repo's worktrees. terminals() has no
    // branch, so the checkout folder's name stands in for it (deploy names folders after their branch).
    const wt = this.ctx?.wt;
    const x = wt && terminals().find((x) => x.status && x.cwd?.startsWith(`${wt}/`) && branchIssue(x.cwd.slice(wt.length + 1).split("/")[0]) === n);
    return x ? sub(x) : null;
  }

  picked() {
    return (this.known ?? []).find((a) => a.key === shared(AGENT_PICK)) ?? this.known?.[0] ?? null;
  }

  // The command LAUNCH / DISPATCH run: the picked agent's `run`, plus its YOLO flag when the box is ticked.
  argvFor() {
    const run = this.picked()?.run ?? DEPLOY_ARGV;
    return (shared(YOLO_ON) && yoloArgv(run)) || run;
  }

  // git worktree add for `branch` off `base` under the worktree root; "" when ready, else the error line.
  // An existing branch is checked out; an existing checkout ("already exists") is reused.
  async worktree(branch, base) {
    const { main, wt, on } = this.ctx;
    const git = (args) => exec("git", ["-C", main, ...args], { on, timeout: 600_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
    const has = (await git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).code === 0;
    const r = await git(has ? ["worktree", "add", `${wt}/${branch}`, branch] : ["worktree", "add", "-b", branch, `${wt}/${branch}`, base]);
    return r.code === 0 || /already exists/i.test(r.stderr ?? "") ? "" : (r.stderr || "git worktree add failed").trim().split("\n")[0].slice(0, 80);
  }

  // The one place this mod writes (git worktrees, local terminals; never GitHub), on a click.
  act(job, cx, work) {
    this.deploying = `${job.kind}${job.number}`; this.deployErr = null; cx.notify();
    cx.spawn(async (cx) => {
      try { this.deployErr = (await work()) || null; } catch (e) { this.deployErr = String(e?.message ?? e).slice(0, 80); }
      this.deploying = null;
      cx.notify();
    });
  }

  // ▶ LAUNCH (milestone): a worktree space on milestone-<n>-<slug> running the picked agent as the lead. It reads
  // the milestone, orders the issues by their dependencies, and hands them to subagents the way DISPATCH does.
  launch(job, cx) {
    const { wt, on, repo } = this.ctx;
    const argv = this.argvFor(), branch = milestoneBranch(job.number, job.title);
    this.act(job, cx, async () => {
      const err = await this.worktree(branch, "HEAD");
      if (err) return err;
      const task = [
        `You lead milestone M${job.number} "${job.title}" in ${repo} (${job.url}). You coordinate; you don't write the code. One issue = one branch = one PR to the default branch.`,
        `1. Read the goal (gh api repos/${repo}/milestones/${job.number} --jq .description) and the open issues (gh issue list --milestone "${job.title}" --state open), each with gh issue view. Find the default branch: gh repo view ${repo} --json defaultBranchRef -q .defaultBranchRef.name.`,
        `2. Check what already exists before starting anything: git worktree list, hc ls --json (cwd) and gh pr list show issue-<n>-… worktrees, agents and PRs from earlier runs. Take those over (follow them, don't restart them).`,
        `3. Work out which issues depend on which: what has to land first, what can run in parallel. Write that plan down here first.`,
        `4. Start each issue whose dependencies are already merged into the default branch, as a sub-agent of yours in its own worktree off the freshly fetched default branch:`,
        `   git fetch origin && git worktree add -b issue-<n>-<slug> ${wt}/issue-<n>-<slug> origin/<default branch>`,
        `   hc run --bg --name issue-<n> --cwd ${wt}/issue-<n>-<slug> -- ${argv.join(" ")}`,
        `   then, once hc get issue-<n> shows it idle: hc send issue-<n> "<the issue: number, title, url, what to do. Commit with Closes #<n> in the message, push issue-<n>-<slug>, open a PR to the default branch with Closes #<n> in the body (gh pr create). Don't merge it.>"`,
        `   Start them with exactly that command (${argv.join(" ")}): add no flags of your own. The person picked it.`,
        `   Don't give them panes (terminal.keep would pull the person's focus); they show under you in the agents list, and you get a note when one ends.`,
        `   (<slug>: the title's ASCII words, lowercase, joined by dashes, at most 40 characters. The JOBS panel links agents and PRs to their issue by that branch.)`,
        `5. Follow them with hc wait, hc read and gh pr view. Merging is the person's call, never yours: when a PR is ready, tell the person which PR to review, and which issues its merge unblocks. Start a dependent issue only once what it needs is merged.`,
        `6. Don't merge PRs, close issues or close the milestone. When every issue has its PR, end with a list: each PR to review and merge, in order; then "close milestone M${job.number} \"${job.title}\" (${job.url}) once they're merged; GitHub never closes milestones".`,
      ].join("\n");
      // Already open there (a second click, or a lead that's gone): go to that space instead of making another.
      const open = spaces().find((sp) => (sp.machine ?? null) === (on ?? null) && (sp.folder === `${wt}/${branch}`
        || panes().some((p) => p.cwd?.startsWith(`${wt}/${branch}`) && (sp.tabs ?? []).some((tb) => tb.id === p.tab))));
      if (open) { run("space.select", { id: open.id }); return ""; }
      run("space.new", { folder: `${wt}/${branch}`, machine: on ?? "", tab: `M${job.number}`, argv, task });
      return "";
    });
  }

  // ▶ DISPATCH (issue): one issue, one branch, one PR. A worktree on issue-<n>-<slug> off the default branch (the
  // main checkout's HEAD), then the picked agent there with the issue as its task: commit with Closes #<n>, push,
  // open a PR to the default branch, don't merge it.
  // - Milestone lead running: a sub-agent of the lead (hc run --bg --parent), so the lead gets its notes and Herdr
  //   keeps the link; then terminal.keep gives it a tab in the lead's space (and focus: you clicked for it).
  // - No lead: a `#<n>` tab in the project's space (whose folder, or a pane, is the main checkout); none → a space.
  dispatch(job, cx, cache) {
    const { wt, on, repo, main } = this.ctx;
    const argv = this.argvFor(), branch = issueBranch(job.number, job.title), path = `${wt}/${branch}`;
    const m = cache?.milestones?.find((x) => x.number === cache.milestone), lead = m ? this.leadFor(m.number) : null;
    this.act(job, cx, async () => {
      const err = await this.worktree(branch, "HEAD");
      if (err) return err;
      const task = `Work on GitHub issue #${job.number} in ${repo}: ${job.title}\n${job.url}\nRead it with \`gh issue view ${job.number}\`. Implement it on this branch (${branch}) and commit with \`Closes #${job.number}\` in the message. Then push the branch and open a PR to the default branch (gh pr create) with \`Closes #${job.number}\` in the body. Don't merge it: reviewing and merging is the person's call.`;
      if (!lead) {
        const home = spaces().find((sp) => (sp.machine ?? null) === (on ?? null) && (sp.folder === main
          || panes().some((p) => p.cwd === main && (sp.tabs ?? []).some((tb) => tb.id === p.tab))));
        if (home) run("tab.new", { space: home.id, folder: path, name: `#${job.number}`, argv, task });
        else run("space.new", { folder: path, machine: on ?? "", tab: `#${job.number}`, argv, task });
        return "";
      }
      const name = `issue-${job.number}-${Date.now().toString(36).slice(-4)}`; // unique among live terminals
      const r = await exec("hc", ["run", "--bg", "--json", "--name", name, "--cwd", path, "--parent", lead.address,
        ...(on ? ["--on", on] : []), "--", ...argv], { timeout: 30_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code !== 0) return (r.stderr || "hc run failed").trim().split("\n")[0].slice(0, 80);
      let addr = name;
      try { addr = JSON.parse(r.stdout).address ?? name; } catch {}
      run("terminal.keep", { terminal: addr });
      // The task waits until the agent says it's idle (typed earlier it would land in the shell).
      for (let i = 0; i < 45; i++) {
        if ((await exec("hc", ["send", "--if", "idle", addr, task], { timeout: 10_000 }).catch(() => ({ code: 1 }))).code === 0) return "";
        await sleep(2);
      }
      return `agent never went idle; send the task by hand (hc send ${addr} …)`;
    });
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
      : { tag: job.kind === "pr" ? "JOB" : job.main ? "MAIN JOB" : "SIDE JOB", id: `#${job.number}` };
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
    const ms = job.kind === "milestone" ? msInfo(job.ms) : null;
    const tall = Boolean(ms) || Boolean(job.tags?.length);
    const ag = job.kind === "issue" ? this.agentFor(job.number) : job.kind === "milestone" ? this.leadFor(job.number) : null;
    return h_flex().id(`job-${job.kind}-${job.number}`).relative().when(!tall, (el) => el.h(46).items_center()).when(tall, (el) => el.py(7).items_start()) // tall: emblem stays at the top
      .flex_none().pl(8).pr(8).gap(8).rounded(0)
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
          .child(div().flex_none().text_color(job.risk === "VERY HIGH" ? t.blocked : t.accent).child(`RISK: ${job.risk}`))
          // Issues: who has it (first login, +n for the rest), or UNASSIGNED. Undefined in an old cache: nothing.
          .when(Array.isArray(job.assignees), (el) => el
            .child(div().flex_none().text_color(t.dim).child("·"))
            .child(div().min_w(0).truncate().text_color(job.assignees.length ? t.foreground : t.dim)
              .child(job.assignees.length ? `@${job.assignees[0]}${job.assignees.length > 1 ? ` +${job.assignees.length - 1}` : ""}` : "UNASSIGNED")))
          // Every issue closed, the milestone still open: GitHub never closes milestones, so say it's ready to close.
          .when(Boolean(ms) && ms.total > 0 && ms.done === ms.total, (el) => el.child(div().flex_none().text_color(t.dim).child("·"))
            .child(div().flex_none().text_color(t.done).child(`ALL DONE → CLOSE M${job.number}`)))
          // An open PR from its branch: waiting on your review (draft: still in progress).
          .when(Boolean(job.openPR), (el) => el.child(div().flex_none().text_color(t.dim).child("·"))
            .child(div().flex_none().text_color(job.openPR.draft ? t.muted : t.done).child(`PR #${job.openPR.number}${job.openPR.draft ? " DRAFT" : ""}`)))
          // An agent on it: its state word in the state color.
          .when(Boolean(ag), (el) => el.child(div().flex_none().text_color(t.dim).child("·"))
            .child(div().flex_none().text_color(t[ag.status] ?? t.foreground).child(`▶ ${WORD[ag.status] ?? String(ag.status).toUpperCase()}`))))
        // Issue labels: a square in the label's GitHub color + its name; up to 3, then +n.
        .when(Boolean(job.tags?.length), (el) => el.child(h_flex().pt(3).gap(8).min_w(0).overflow_hidden().font_family(MONO).text_size(9)
          .children(job.tags.slice(0, 3).map((g) => h_flex().flex_none().gap(4).items_center()
            .child(div().size(6).flex_none().bg(g.color))
            .child(div().text_color(t.muted).child(g.name))))
          .when(job.tags.length > 3, (r) => r.child(div().flex_none().text_color(t.dim).child(`+${job.tags.length - 3}`)))))
        // Milestone extras: progress (closed/total), due date, the description's first line.
        .when(Boolean(ms), (el) => el
          .child(h_flex().pt(3).gap(6).items_center()
            .child(h_flex().flex_1().gap(2).children(Array.from({ length: 10 }, (_, i) =>
              div().flex_1().h(5).rounded(0).when(i < Math.round(ms.pct / 10), (b) => b.bg(t.working)).when(i >= Math.round(ms.pct / 10), (b) => b.border(1).border_color(t.border)))))
            .child(div().flex_none().font_family(MONO).text_size(9.5).text_color(t.foreground).child(`${ms.done}/${ms.total} · ${ms.pct}%`)))
          .child(div().truncate().font_family(MONO).text_size(9.5).text_color(ms.hot ? t.blocked : t.muted).child(ms.due))
          // Owner line: who created it (the only person GitHub records), then the crew.
          .child(h_flex().gap(6).min_w(0).font_family(MONO).text_size(9.5)
            .when(Boolean(job.ms.creator), (r) => r.child(div().flex_none().text_color(t.dim).child("BY"))
              .child(div().flex_none().text_color(t.foreground).child(`@${job.ms.creator}`)))
            .child(div().flex_none().text_color(t.dim).child("CREW"))
            .child(div().min_w(0).truncate().text_color(job.crew.length ? t.foreground : t.dim)
              .child(job.crew.length ? job.crew.slice(0, 2).map((a) => `@${a}`).join(" ") + (job.crew.length > 2 ? ` +${job.crew.length - 2}` : "") : "NONE")))
          // ponytail: up to DESC_LINES source lines, each cut to one row (gpui has no line_clamp).
          .child(v_flex().pt(2).gap(1).children(plain(job.ms.description).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, DESC_LINES)
            .map((l) => div().truncate().text_size(11).text_color(t.muted).child(l))))))
      .when(same(job, tracked), (el) => el.child(this.trackIcon(t)));
  }

  empty(t, text) {
    return div().px(4).py(4).font_family(MONO).text_size(11).text_color(t.dim).child(text);
  }

  // One section: bar, then (when open) up to MAX cards and `+n MORE` (opens the repo's issue list).
  group(t, repo, key, title, jobs, sel, tracked, extra = [], none = "NONE") {
    const out = [this.bar(t, key, title, jobs.length)];
    if (this.closed[key]) return out;
    // `extra` (the milestone picker) goes right under the milestone card, before its issues; else at the end.
    const cards = jobs.slice(0, MAX).map((j) => this.card(t, repo, j, sel, tracked));
    const at = jobs.slice(0, MAX).findIndex((j) => j.kind === "milestone");
    if (at >= 0 && extra.length) { cards.splice(at + 1, 0, ...extra); extra = []; }
    out.push(...cards);
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
    const md = body == null ? null : String(body).replace(/<!--[\s\S]*?-->/g, "").trim(); // template comments out
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
        .when(md === "", (el) => el.child(div().font_family(MONO).text_size(11).text_color(t.dim).child("NO BRIEFING")))
        // The body as rendered markdown (lists, code, links), in the theme's text color; links open like OPEN does.
        .when(Boolean(md), (el) => el.child(div().text_size(12.5).text_color(t.muted)
          .child(TextView.markdown(`brief-${job.kind}-${job.number}`, md).selectable(true).on_link_click((url, cx) => this.open(url, cx))))))
      // Pinned under the scroll area, above TRACK / OPEN: the milestone's lead or the issue's agent.
      .when(job.kind !== "pr", (el) => el.child(v_flex().flex_none().gap(4).pt(6).border_t(1).border_color(t.border)
        .child(label(job.kind === "milestone" ? "//03 LEAD" : "//03 AGENT")).child(this.agentSection(t, job, cache))))
      .child(h_flex().flex_none().gap(6).pt(4)
        .child(this.button(t, "track", isTracked ? "UNTRACK" : "TRACK", !isTracked,
          () => setShared(trackKey(repo), isTracked ? null : { kind: job.kind, number: job.number })))
        .child(this.button(t, "open", "OPEN", false, (_e, cx) => this.open(job.url, cx))));
  }

  // Milestone → its lead (▶ LAUNCH: worktree space + lead agent); issue → its agent (▶ DISPATCH: the lead's sub-agent
  // as a tab, or a plain tab without a lead).
  // Running: its state and JACK IN. Not running: the agent dropdown and the button.
  agentSection(t, job, cache) {
    const ms = job.kind === "milestone";
    const a = ms ? this.leadFor(job.number) : this.agentFor(job.number);
    const mono = (s, c = t.muted) => div().min_w(0).truncate().font_family(MONO).text_size(11).text_color(c).child(s);
    if (a) return h_flex().gap(8).items_center()
      .child(div().flex_none().font_family(MONO).text_size(11).text_color(t[a.status] ?? t.foreground).child(`▶ ${WORD[a.status] ?? a.status}`))
      .child(div().flex_1().min_w(0).child(mono(`${a.space_name} / ${a.tab_name}`, t.foreground)))
      .child(this.button(t, "jack-in", "JACK IN", true, () => { if (a.peek) run("terminal.peek", { terminal: a.address }); else { run("space.select", { id: a.space }); run("pane.focus", { pane: a.pane }); } }));
    if (ms) { const info = msInfo(job.ms); if (info.total > 0 && info.done === info.total) return mono(`ALL ISSUES CLOSED // close M${job.number} on GitHub (OPEN)`, t.done); }
    if (!this.ctx?.wt) return mono("NO AGENT // can't find this machine's home", t.dim);
    const busy = this.deploying === `${job.kind}${job.number}`;
    const pick = this.picked();
    const go = ms ? "▶ LAUNCH" : "▶ DISPATCH";
    // Dropdown: the picked agent with ▾; open, the installed agents listed in place (like the milestone picker).
    const head = h_flex().id("agent-pick").flex_1().min_w(0).h(22).px(6).gap(6).items_center().rounded(0).cursor_pointer()
      .border(1).border_color(this.agentOpen ? t.accent : t.border).hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { this.agentOpen = !this.agentOpen; cx.notify(); })
      .child(div().flex_none().font_family(MONO).text_size(9).text_color(t.dim).child("AGENT //"))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground)
        .child(pick?.name ?? (this.known ? "NO AGENTS INSTALLED" : DEPLOY_ARGV.join(" "))))
      .child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child(this.agentOpen ? "▴" : "▾"));
    const options = this.agentOpen ? (this.known ?? []).map((k) => h_flex().id(`agent-${k.key}`).h(22).pl(12).pr(4).gap(6).items_center().cursor_pointer()
      .hover((st) => st.bg(t.hover))
      .on_click((_e, cx) => { this.agentOpen = false; setShared(AGENT_PICK, k.key); cx.notify(); })
      .child(div().size(6).flex_none().when(k.key === pick?.key, (el) => el.bg(t.accent)).when(k.key !== pick?.key, (el) => el.border(1).border_color(t.dim)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(k.key === pick?.key ? t.foreground : t.muted).child(k.name))) : [];
    return v_flex().gap(4)
      .child(mono(`NO ${ms ? "LEAD" : "AGENT"} // ${ms ? milestoneBranch(job.number, job.title) : issueBranch(job.number, job.title)}`, t.dim))
      .child(h_flex().gap(6).items_center().child(head)
        // YOLO: the agent's own skip-permission flag; off and dimmed for an agent without one.
        .child(((can, on) => h_flex().id("yolo").flex_none().h(22).px(4).gap(4).items_center()
          .when(can, (el) => el.cursor_pointer().on_click((_e, cx) => { setShared(YOLO_ON, !on); cx.notify(); }))
          .child(div().size(10).flex_none().border(1).border_color(on ? t.blocked : can ? t.muted : t.border).when(on, (el) => el.bg(t.blocked)))
          .child(div().font_family(LABEL).font_weight(600).text_size(10.5).text_color(on ? t.blocked : can ? t.muted : t.border).child("YOLO")))
          (Boolean(yoloArgv(pick?.run ?? DEPLOY_ARGV)), Boolean(shared(YOLO_ON)) && Boolean(yoloArgv(pick?.run ?? DEPLOY_ARGV))))
        .child(this.button(t, "deploy", busy ? (ms ? "LAUNCHING…" : "DISPATCHING…") : go, !busy,
          (_e, cx) => { if (!busy) (ms ? this.launch(job, cx) : this.dispatch(job, cx, cache)); })))
      .children(options)
      .when(Boolean(this.deployErr), (el) => el.child(mono(`ERROR // ${this.deployErr}`, t.blocked)));
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
    if (!job && this.wide) job = findJob(secs, tracked) ?? [...secs.main, ...secs.side][0] ?? null;
    const sel = job && { kind: job.kind, number: job.number };

    const list = v_flex().id("jobs-scroll").min_h(0).overflow_y_scrollbar().gap(4).pt(8).pr(this.wide ? 10 : 0)
      .children(this.group(t, repo, "main", "MAIN JOBS", secs.main, sel, tracked, this.picker(t, repo, cache), "NO PR // NO MILESTONE"))
      .children(this.group(t, repo, "side", "SIDE JOBS", secs.side, sel, tracked, [], "NO ISSUES WITHOUT A MILESTONE"));

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
