# cyberneon-spaces — v2 notes

## Changed (restyle only; logic of the shipped `spaces` untouched)
- Panel title `SPACES` and machine names (`THIS COMPUTER`, remote names): caps Chakra Petch 600 11px `accent`,
  with the agents-list rule under each (1px `border` + 24px `accent` lead). Helpers: `label()`, `rule()`.
- Machine sections are numbered `//01`, `//02` (Share Tech Mono 9px `dim`) in front of the icon + label.
- Rows, buttons, empty/new rows, the Copy button and the rail cells are square (`rounded(0)`).
  Space avatars: sharp 16px squares in each space's own color. Connected dot and rail badge are 6×6 squares.
- Active space: `selected` fill, a 3px `accent` bar (absolute div, so no layout shift),
  `ACTIVE` tag at the right edge (`solid` fill via `paint_path` with a 4px top-left cut, `solid_foreground`
  Chakra Petch 700 9px), and 8×8 1px `accent` corner brackets at top-left and bottom-left.
  The brackets sit at `left(-5)`, `top/bottom(-2)`: at `left(0)` they were lost inside the 3px bar.
- Branch/repo subtitle and `↑n`/`↓n` counts: Share Tech Mono 11px (colors unchanged).
- Rail (collapsed): numbers in Share Tech Mono, active cell gets the 3px `accent` bar.

## Animation switch
No animation was added, so `cyberneon.animations` has nothing to turn off here.

## Kept
Click to select, right-click menu (rename lives there), drag-to-reorder with the 2px drop line, `+` buttons
(panel, per machine, "New space there"), machine fold/reconnect/login guidance, worktree nesting, git refresh.

## Caveats
- Right after a hot reload the git subtitles are blank until the first git look finishes (in-memory cache).
- Install: `rm -rf` on the installed folder was denied, so I used `cp -R mods/cyberneon-spaces/. <installed>/`.
- Crop shots with `ffmpeg -vf crop=W:H:X:Y`: `sips --cropOffset` didn't crop from the top-left here.

## v3 unify (copied from cyberneon-agents/main.js)
- Rows: h30, `pl(7) pr(6)`, inner gap 8, real `border_l(3)` (`border`; active `accent`), hover `hover`, active `selected`.
  Worktree rows are 30 too (was 28). The old absolute accent bar is gone.
- Name: UI font 13 (inherited), `max_w(120)` with a subtitle else 200, `muted`; active `foreground`.
  Subtitle `· repo · branch`: same line, gap 5, `flex_1` truncate, `dim`, UI font 13 (agents' detail text).
- Counts `↑n`/`↓n`: Share Tech Mono **11px** `dim` (the agents' times are 11px in code, the brief said 10).
  No `±n`: this mod reads refs only and never runs `git status` (no change count exists to show).
- Avatar: 16px square, 1px `border`, letter Share Tech Mono 10 `muted`; active `accent` fill + `accent_foreground`.
  The `space.colors` assignment was removed here; cyberneon-picker still keeps that shared map itself.
- Section header (wide): the agents header verbatim (`px4 pt10 pb4 gap3`, 18px line gap 6, `//NN` + Chakra 11 `accent`,
  rule inside). Machine icon dropped on the wide sidebar (agents has none); the rail keeps it. `+`, state text, square, chevron kept.
- Connected square/badge: `working` instead of `ansi2` (green isn't in the palette).
- ACTIVE tag (h14) and brackets fit the 30px row; brackets at `left(-5)` now sit 2px outside the bar's outer edge.
- Rail: same `border_l(3)` bar rule, `selected`/`hover`.

## v4 map
- The map **replaces** the spaces list: the sidebar always draws it; no toggle, no right-panel page (the
  `role: "map"` branch and the tabs MAP button were removed again). The rail (<160px) keeps its numbered cells.
- The old list code was **deleted**, not hidden (it was self-contained, so removing it was low-risk). Gone with it:
  git subtitles/ahead-behind, the git and `hc machine ls` timers, worktree reordering (`space.move`), drag-to-reorder,
  machine fold, reconnect/login guidance, per-machine `+`. The header `+` (new space) stays.
- `districts.js` (pure): each machine region is a grid of 26 sectors A..Z (columns from the width, rows after);
  first letter of the name picks the sector (non-letters -> last), second letter the offset inside it. Districts go
  in name order; a collision moves the later one to the nearest free spot on a 4px lattice. Unused rows collapse.
  4+ tabs = a wider, taller block. Sidebar sectors aim for 90px (3 columns at the 340px sidebar). `main.js` memoises the result per region. Check: `node mods/cyberneon-spaces/districts.check.mjs`.
- Names: Rajdhani SemiBold 12 truncated when the block is >=52px wide, else the 2-4 letter `code()` (ELND, HGAL).
- Blips: working breathe, blocked hard blink + `blocked` outline, done yellow, idle hollow; max 8 then `+n`.
  All loops gated by `cyberneon.animations`. Grid/highways: one stroked `paint_path` each.
- **The map reaches GitHub's API through `gh`, read-only.** Per space folder: `git -C <folder> remote get-url origin`
  (once), then per github.com repo one `gh api graphql` query for open issue/milestone counts. Cached in
  `shared("cyberneon.map.quests.<owner/repo>")` as `{at, issues, milestones}` or `{at, error}`; refreshed at most
  every 10 min (errors too), one call at a time across copies (`cyberneon.map.quests.fetching`, ignored after 60s).
  One 60s timer drives it. Never writes to GitHub.
- Markers (static): milestones 7x7 filled `done` diamonds (max 3), issues 5x5 outlined (max 5), then `+n` Mono 8 `dim`;
  `◆n ◇n` counter when the block is >=90x48. Tooltip: name · branch · MILESTONES n // ISSUES n · agent counts.
- Gotcha: editing `data/<mod>/store.json` on disk doesn't reach a running mod's localStorage (held in memory).

## v4.1 look
- Game-map visual language only (no traced shapes, names or emblems; all geometry comes from our data).
- Sea `#0a1220` behind everything; land = one fill path per region (each district cell grown 6px, `canvas`).
- Districts: `shape(name, w, h, tabs)` in districts.js gives a polygon (1-3 cut corners at 45°, 1-2 notches, sizes from
  a mulberry32 PRNG seeded by the name hash) and city-block texture rects (2-6px, gaps 1-2px, kept only if all four
  corners are inside; density 0.35 + 0.08 per tab, max 0.85). Fill `canvas` at 60%; texture `accent` at 25% as ONE path.
- Outline 1.5px (active 2px, full brightness; inactive 70%; hovered full) + glow strokes 3px @0.2 and 6px @0.08.
  Colour by name hash from `accent`, `done`, `working`, `ansi5`, `ansi9`. Blocked: `blocked` outline + glow, hard blink,
  and a yellow `!` above the district.
- Roads: `roads(boxes, w, h)` = each centre to its nearest 1-2 neighbours as 2-segment elbows, plus 2-3 highways to the
  region edge; one stroked path per region (`working` @0.6), under the districts.
- Callout (`popover`, 1px `border`): caps name Rajdhani Bold 12 + `AGENTS:` markers or `BRANCH: <name>` in 9px red caps.
  Only for the active and the hovered district (`on_hover`); others show a 9px caps name in their outline colour.
- Agent markers: 7x7 1px `working` outline (working breathes), blocked red filled + blink, done yellow filled.
  Quest diamonds unchanged. All loops gated by ANIM OFF.
- Cost: 5 paths per district (fill, texture, two glows, outline) + land + roads per region. `geometry()` memoises boxes,
  shapes and the built `Path`s by [names, tab counts, width]; renders only re-pick colours.
- Check covers the new functions: polygons and texture inside the cell, roads inside the region, determinism.

## v4.2 terrain
- Supersedes the v4.1 callout: every district now has a label plate, and hovering opens a card.
- `region(input, avail, seed)` in districts.js is the one pipeline used by both main.js and the check, so the widths
  can't drift apart. `avail` is the real drawable width: the measured block (or the layout's sidebar px before the first
  measure) minus 2×8 padding and 6 for the scrollbar. Districts are inset 10px (x) and 12px (y) to leave room for the coast.
  The live sidebar is 458px wide now (window state; the layout file still says 340), so the shots are cropped at 458.
- Terrain (pure, seeded by the machine name): an x-monotone landmass from a conservative profile of the
  districts' cells grown by 10px, plus value-noise wobble (out up to 9px, inlets at most 7px deep) → about 76 vertices.
  River: the widest horizontal band no district touches, else the widest vertical one (sine curve, 4-8px, `SEA` with
  faint `working` banks). Straight road segments crossing it get two 6px bridge rails. Suburbs: 2-5px blocks on land
  within 18px of a district, avoiding districts and the river. 1-3 islets below the coast. Region height = coast + islets.
- Layers per region are one path each: coast glow (5px @0.06), land fill `#151822`, coast 1px (`working` @0.3),
  suburbs (`accent` @0.12), islets, river banks + river, roads, bridges.
- **Render time budget**: the mod's JS engine is far slower than node; building terrain inside render got the view
  "interrupted" (the old frame stayed up). Builds and label placement now run as queued jobs, **one per timer tick**
  (`pump()`: two builds in one tick were cut off too and left the queue stuck). Render draws the last result.
  A failed job prints its error at the bottom of the map.
- Labels: `labels(items, width, avoid)` = full caps name (Rajdhani Bold 11) on a `popover`@85% plate with a 1px `border`;
  active: full `popover`, `accent` border, yellow square. Tries inside top-left, right-outside, below, above; then
  truncates (at least 8 chars with …); then the nearest free spot. Avoids other plates, every district's blip row and quest
  markers. Width estimate is 7.4px per caps character (6.6 cut off `MYWORK`).
- Hover card: `Popup` anchored at the district's right edge, opened 300ms after hover. It stays open while the pointer is
  on the district, its plate or the card, and closes 250ms after the pointer has left all of them.
  Header: caps name, `DISTRICT // 0xNNN` (hash of the space id), `◆n ◇n`, branch. Rows: every agent in the space
  (blocked > done > working > idle), sub-agents from `terminals()` indented with `└`, program icon, name, time since
  `status_ms`, state chip (`INPUT REQ` / `COMPLETE` / `EXEC` / `STANDBY`). At most 12 rows, then `+n MORE`;
  `NO ACTIVE AGENTS` if none. Click → `agent.focus {terminal}`.
- Seen live: terrain, river and bridges, both islands, every name readable, the card opened by a real hover.
  Not seen live: a blocked district, ANIM OFF, the card's stay-open timing, sub-agent rows (no sub-agents ran at the time).

## v4.3 points
- Supersedes the v4.1/v4.2 district blocks, plates, blips and quest markers (all deleted, with `shape()`).
  Kept: terrain, roads + highways, bridges, A-Z placement, quests/gh cache, hover card, click/right-click, ANIM OFF.
- Placement: `districts()` got a `size` option; each space is a 44px cell (neighbours >= 48px apart so tags fit),
  point = cell centre, 28px hit area in the middle. `MAP = { size 44, rowH [44,50], rowGap 24, MX/MY 30, M 30 }`.
  With 28px cells, the six A-names of the stress set clumped and their tags fell back below the map.
- Point: 7px `DIAMOND` in the most urgent state (blocked blink, done, working breathe, else `muted`). Ring r9 split
  into one arc per agent (max 12, ~2px gaps, polylines from `ring()`), one stroked path per state colour; no agents
  = full `muted` ring. Active: `accent` ring r12 + 8px corner brackets at ±16. Paths draw in a 40px box around the hit box.
- Tag (`labels()` in districts.js, pure): line 1 `NN NAME` Rajdhani Bold 11, line 2 Share Tech Mono 8.5
  `▲b ●w ○i · branch(12) · ◆m◇i` (nonzero parts only; done agents aren't counted there, the diamond shows them).
  `solid` fill (`blocked` if any agent is blocked), `solid_foreground` text, 4px top-left cut; active adds a 1px `accent`
  edge. Candidates NE,E,SE,NW,W,SW,N,S at 14/20/26/30px; then the name shrinks to 4 chars with `…`; then the nearest
  free spot on a 3px lattice (offsets pre-sorted by distance, first hit wins); last resort `far`: stacked below every
  tag and point, its leader may cross. Rules: no tag overlaps a tag or a point (13px keep-out circle), no leader
  crosses a tag. Widths come from advances measured in the font files (+5%); ▲●○◆◇ aren't in Share Tech Mono.
- Leaders: one 1px `solid` path per region, from the tag's nearest corner to the ring.
- Legend under each region header: two columns, `01 — name` Mono 9 (`solid` number, `muted` name, active `foreground`),
  click selects, right-click opens the menu. Numbers run A-Z per region and continue across machines.
- Suburbs: blocks within 50px of a point, probability 0.8 up to 20px then fading (`((50-d)/30)^1.5`), none inside 14px
  (the ring), not on the river; still one path. Coast inlets capped at 9px now that the margin is 30.
- Jobs: the tag job (`tags()`) places tags and builds tag, leader and ring paths; keyed by geometry + every item's
  text/states, so a status change re-queues it (one per tick via `pump()`).
- Check: points on land and >= 14px off the river band, tags inside the width, no tag/tag or tag/point overlap, no leader
  through a tag, region + label determinism, `ring()` arcs. 9 spaces at >= 250px must place with no `far` tag;
  the 20-space stress set at 138-318px stacks some (count printed).
- Seen live (458px): every tag readable, active ring + brackets + accent edge, legend, leaders, clustered texture, and
  the hover card opened by a real hover. Not seen: a blocked space, ANIM OFF, a `far` tag. No separate hover shot:
  herdr-app has no pointer command and I didn't move the user's cursor.

## Fix: map jumped back to the top on hover
- Reported by the person: scroll the map down, hover a point, and it jumped back to the top.
- Fix: `this.mapScroll = ScrollHandle.new()` in `init()`, `.track_scroll(this.mapScroll)` on `#map-scroll`,
  so the scroll position lives in the handle, not only in the element's state. The debug line now comes
  after the scroll area, so showing it can't shift the scroll area's place in the tree.
- Not reproduced by the agent (no pointer control); the person confirmed the fix works (2026-11-13).
