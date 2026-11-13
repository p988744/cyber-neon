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
