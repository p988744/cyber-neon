# cyberneon-jobs — notes

## v3
A quest tracker driven by GitHub. One mod, two copies placed by the layout:
- `role: "hud"`: floating card at the top right of `main`. A yellow `JOB` tag, `#n` (Share Tech Mono), the PR title
  (Rajdhani Bold 14, truncated), up to 3 not-done objectives (8×8 squares: hollow `muted` open, `done` filled,
  `blocked` red), then `+N MORE` in `dim`. With no PR it shows the selected milestone (`MILESTONE` tag, `closed/total`,
  its open issues). With neither, or on error, it renders `div()` and hides. Click opens the journal
  (`layout.select` panel-body/jobs + `layout.show` panel).
- `role: "journal"`: header line `owner/repo // branch // 42S AGO` + square `SYNC` (forces a fetch),
  then `//01 MAIN JOB`, `//02 MILESTONE`, `//03 SIDE JOBS` with the agents-list rule. Rows open their URL
  (`cx.open_url`, else `exec("open")`). The milestone selector expands inline; the pick is saved with
  `setShared("cyberneon.jobs.milestone.<owner/repo>", number)`. The bar is `done` yellow on `border`, with `n/m`.

## Network
**This mod reaches GitHub's API through `gh`** (the user's own login), strictly read-only:
`gh pr view`, `gh issue list`, `gh api repos/<repo>/milestones?state=open` (GET). Plus read-only
`git remote get-url origin` and `git rev-parse --abbrev-ref HEAD` to find the repo and branch.

## Data
- Folder: the focused pane's `cwd`, else the active space's folder (and its `machine` for `exec on`).
  The remote must be on github.com, else the journal shows `NO UPLINK // not a GitHub repo`.
- Objectives: each CI check (SUCCESS, and also SKIPPED/NEUTRAL, count as done, because they never turn green;
  FAILURE/ERROR/CANCELLED/TIMED_OUT/… are `blocked`), `REVIEW` (APPROVED done, CHANGES_REQUESTED blocked),
  and each `- [ ]`/`- [x]` line of the PR body.
- Cache: `cyberneon.jobs.cache.<owner/repo>` = `{at, branch, milestone, pr, issues, milestones, milestoneIssues}`
  (or `{…, error}`). Lock: `cyberneon.jobs.fetching` = `{repo, at}`, ignored after 90s so a crash can't hold it.
- Each copy ticks every 15s (local git only); it fetches when the branch changes, the milestone pick changes,
  or the cache is older than 120s. A `gh` error caches `error` and isn't retried for 5 min. `SYNC` still retries
  at once (an explicit click). A folder change seen in render looks again after 50ms.

## Motion
HUD flicker when an objective turns done: two one-shot timers flip an opacity target (0.15 → 1) under
`.transition("opacity", 60ms)`. The done line stays in the list ~900ms, then drops. Off with `ANIM OFF`
(`watch()` checks `anim()` before arming it). Not seen live (needs a check to finish); verified by reading the code.

## Testing
Tested against a private GitHub repo with an open PR by making `where()` return that folder in the
installed copy only. **The override is removed** (installed copy re-copied from the project; grep finds no
`TEST OVERRIDE`). Shots: `research/v3-shots/jobs-hud.png`, `jobs-journal.png`.
I opened the panel on Jobs for the shot and hid it again afterwards.

## Not seen live
The milestone selector click, the no-PR milestone HUD, the error line from a real `gh` failure.

## cyberneon-tabs
Third panel button `jobs` (`mods/cyberneon-tabs/jobs.svg`, a square target drawn by hand; nothing in
`research/assets/icons/` fit). `enabled` always gets `"jobs"` added in this layout.

## v5 journal
- Layout: the root's `on_size_change` sets `wide` (≥560px). Wide = list | 1px `accent` line | details. The list width is
  `(width-24)*0.42` in px, because `w("42%")` laid out much narrower. Narrow = list. Clicking a card shows the details
  with `◂ BACK`.
- Sections `MAIN JOBS` (branch PR + selected milestone + inline picker), `SIDE JOBS` (assigned to @me, limit 50),
  `GIGS` (open milestone issues whose number isn't in SIDE JOBS, so no `assignees` field or `gh api user` call is
  needed; a 51st assigned issue would show as a gig). Max 30 cards, then `+n MORE` → `github.com/<repo>/issues`.
  Collapsed state is saved in `localStorage["closed"]`, per copy.
- Risk rules (`rules.js`, checked by `node mods/cyberneon-jobs/rules.check.mjs`):
  PR: failed check + CHANGES_REQUESTED = VERY HIGH; one of them = HIGH; draft = LOW; else MODERATE.
  Issue: label matching critical|urgent|p0 = VERY HIGH; bug|p1|priority = HIGH; created >30 days ago = MODERATE; else LOW.
  Milestone: no open issues or no due date = MODERATE; due ≤3 days (overdue counts) = VERY HIGH; ≤7 = HIGH.
- Tracked: `setShared("cyberneon.jobs.tracked.<owner/repo>", {kind, number})`. Unset = the branch's PR; `null`
  (UNTRACK) = nothing. Selection is shared too (`cyberneon.jobs.selected.<repo>`), so a HUD click opens the journal
  on that job. The HUD shows the tracked job, else falls back to the v3 behavior (PR, else milestone).
- Body: issues only, fetched on select (or when the HUD tracks one) with `gh issue view <n> --json body`. Cached as
  `cyberneon.jobs.body.<repo>#<n>` = `{at, body[, error]}`, refetched at most every 10 min, with a 30s `loading` marker
  so the two copies don't both fetch. The PR body already comes with the main `gh pr view` and milestone text with the
  milestones call, so neither makes a second call. Markdown is stripped with regexes (`plain()`): nested or odd markup
  can leave stray marks (seen: `**vX**` split across a line break).
- Extra fields, in calls the mod already makes: issue lists add `labels,createdAt`; milestones keep `due_on,open_issues,description`.
- Tested on a private repo's PR with temporary `TEST OVERRIDE`s in the installed copy only (folder, tracked
  default, narrow selection). **All removed**: the installed copy was re-copied from the project and grep finds 0.
  Shots: `research/v5-shots/journal-narrow.png`, `journal-detail.png`, `journal-wide.png`. For the wide shot the panel
  was set to 680px with `layout.resize`, then put back to 368px.
- Not seen live: card clicks, TRACK/BACK clicks, section toggles, `DECRYPTING…` for an issue body (no pointer control;
  this repo's only issue job wasn't selected).

## Milestone card extras
- The milestone main job card adds a 10-segment progress bar (`closed/total · pct%` from the milestones API's own counts, not the 50-issue list), `DUE <date> · ND LEFT / TODAY / OVERDUE ND` (red when ≤3 days with open issues), and up to 5 description lines (DESC_LINES). Logic in `msInfo()` (rules.js), checked in rules.check.mjs.

## Issue cards: assignees and labels
- Second line ends with `@login +n` or `UNASSIGNED` (`assignees` from `gh issue list`).
- Labels: third row, up to 3, each a square in the label's GitHub color (`#` + `color`) plus its name; `+n` after. Cards without labels keep 46px.

## Milestone owner
- GitHub milestones can't be assigned. The card shows `BY @creator` (milestones API `creator.login`) and `CREW` = open milestone issues' assignees, most issues first, 2 shown then `+n`.

## Issue → agent (JACK IN / DISPATCH)
- Link is by branch name only: `issue-<n>-…` (what deploy makes) or `<n>-…` (gh issue develop). Plus the pane's folder must be this repo's main checkout or under `~/.herdr/worktrees/<repo>/`.
- Deploy mirrors the worktree mod's New worktree (same root and slug rules) and then `space.new` with `task`, which the worktree mod's props can't pass.
- Agent picker: chips from `knownAgents({on})` (installed only), picked key in `cyberneon.jobs.agent`; `DEPLOY_ARGV` is only the fallback. To add flags (e.g. yolo), override that agent's `run` in Herdr's programs.json.

## LAUNCH / DISPATCH (v0.3 design)
- Milestone = a worktree space with a lead agent that plans by dependencies and starts issue sub-agents (hc run --bg, no pane). Issue DISPATCH = the lead's sub-agent given a tab with terminal.keep, or a plain tab when no lead runs.
- terminal.keep (tested): a new tab in the parent's space, named after the terminal; parent kept; the agents list nests it under the parent; it TAKES FOCUS (no option against it), so the lead must not keep its own sub-agents.
- Tried first: issues as `hc run --bg` subagents (label `cyberneon.issue`, `hc send --if idle` loop). Dropped: a parentless one is hidden, and one issue deserves a visible tab. tab.new takes `task`, so no send loop is needed.
- Agent choice is a dropdown (not chips).

## One issue, one PR (replaces the milestone integration branch)
- First design merged issue branches into `milestone-<n>` and opened one big PR at the end. Too big to review. Now each issue branches off the default branch and opens its own PR with `Closes #<n>`; the lead only coordinates and never merges.
- Dependencies: a dependent issue starts after the PR it needs is merged (by the person). The lead says which PR unblocks what.
- `MERGED → M<n>` (git log of the milestone branch) is gone; issue cards show `PR #<n>` from one `gh pr list --state open` per fetch (`issuePRs()`).
- The `milestone-<n>` worktree stays only as the lead's home, so the map and agents list group its agents.

## BRIEFING as markdown
- `TextView.markdown(id, body)` from gpui-base, wrapped in a div with the theme's size and color (it inherits them). Replaced the regex `plain()` strip, which mangled `<n>` (read as an HTML tag) and flattened lists, code and links. `plain()` stays for the milestone card's 5 description lines.
