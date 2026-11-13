# cyberneon-graph — notes

## v6 graph
- GRAPH page in `panel-body` (block `graph`). Local and read-only, no network: one
  `git --no-optional-locks -c core.fsmonitor=false -C <dir> log --all|HEAD --decorate=full --topo-order --date-order -n 300`
  per refresh (`--decorate=full` so `%D` says exactly which refs are branches, remotes or tags).
  Folder: the focused pane's cwd, else the active space's (as cyberneon-jobs), on its machine.
  `rev-parse --show-toplevel --absolute-git-dir` once per folder; failing that = `NO REPO // not a git folder`.
- Refresh: `watchFolder(<git dir>)` loop (local only) → `want()` reruns at most once per 2s; folder change (seen in
  render) and SYNC rerun at once. No timer polling. Remote machines aren't watched (SYNC). A linked worktree's
  branch refs live in the common dir, which isn't watched either.
- `graph.js` (pure): `lanes(commits)` → `{hash, lane, color, merge, edges:[{fromLane,toLane,kind,color}]}`, where
  edges run from this row's centre to the next row's. Kinds: `pass`, `join` (a lane converging into the next commit:
  straight, then 45° into it), `merge` (a merge's line out to another parent: 45° first, then straight). New lanes
  take the first free index and a new color index; free lanes are reused. Check: `node mods/cyberneon-graph/graph.check.mjs`.
- Lanes run in a queued `timer.after(1)` job, memoized by the commit hash+parents key (refs can change without it).
- Rows: a **custom viewport** instead of `v_virtual_list`: the wheel moves `scrollY`, only on-screen rows are built.
  Reason: a virtual list's renderer can't register handlers (only `on_item_click`), and nothing exposes its scroll
  offset, so per-row hover (for the card) couldn't be done. Cost: no draggable scrollbar, only a 2px thumb.
- Graph: one layer for all visible rows: one 1.5px stroke path per lane color (`accent, working, done, ansi5, ansi9,
  ansi6`), one fill path per color for 7px diamonds, merges hollow (a `chrome` fill under a 1px stroke), HEAD a 10px
  `accent` ring. Max 16 lanes drawn.
- Chips: HEAD + local branches yellow with a 4px cut (current adds an `accent` edge), remotes dim outlined, tags
  `◆ name` in `done`. At most 3, then `+n`; chips keep their width and the subject truncates (see the fix below).
- Click copies the full hash (`cx.write_to_clipboard`) and shows `COPIED` for 700ms (none with ANIM OFF; copy still works).
- Hover 300ms → scan-style card left of the panel (`Popup` anchored `top_right`): `COMMIT // short`, hash, author,
  date, parents, `n files changed, +a −d` from `git show --stat` (fetched once per hash; the email is read, never shown).
- Tabs: `graph` button after `jobs` (`cyberneon-tabs/graph.svg`: a trunk, a branch line, two filled and one hollow diamond),
  and `"graph"` always added to `enabled` like `"jobs"`.
- Shot `research/v6-shots/graph.png` used a temporary `where()` override in the installed copy only (the focused pane was
  another project). **Removed**: the installed copy matches the project (`diff -r`). Panel was put back on Jobs.
- Not seen live: the hover card, COPIED, the HEAD toggle, merges/branches (this repo is linear), scrolling (2 rows).

## Fix: ref chips no longer clip
- Chips (max 3, then `+n`) keep their width (`flex_none`); the subject truncates instead (min 40px). A tag showed as `v0.1.`.
