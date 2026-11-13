# cyberneon-agents — v1 notes

## Changed (restyle only; logic untouched)
- Section headers: caps label (priority sections + "Pinned"; space names keep case) in Chakra Petch 600 `accent`,
  count in Share Tech Mono `muted`, then a 1px `border` rule with a 24px `accent` segment at the left.
- Rows: `rounded(0)`, 3px left bar in the row's own state color (`t[status]`), `selected` fill when focused
  (focused text is always `foreground`). Rail (collapsed) rows get the same bar.
- State marks (`status()`):
  - blocked: `INPUT REQ` chip, top-left 4px cut via `paint_path` + `pattern_slash` stripes, hard blink (-6→7, 900ms linear).
    Compact form: 14px hazard "!" with the same stripes and blink.
  - done: yellow solid `COMPLETE` chip, `solid_foreground` text, breathing 0.6→1 / 1400ms. Compact: 6×6 yellow square.
  - working: `EXEC` + Share Tech Mono data bar `.frames(▰▱…, 110ms)` (replaces the spinner). Compact: 6×6 cyan square.
  - idle: 6×6 hollow 1px square in `idle`.
- Times, machine names, fold counts, rail numbers: Share Tech Mono, `dim`.
- Tree lines: 1px `border`, square (no `rounded_bl`). Fold/pin buttons and the sort menu are square.
- Panel title "AGENTS" in Chakra Petch 600 `muted`. Sort (clock/history) button kept.

## Animation switch
`anim()` = `shared("cyberneon.animations") !== false`. All three animations (blink, breathe, data bar)
go through it; off → static chip / static `▰▰▱▱`. No timers added (the existing 30s duration refresh stays).

## Couldn't / didn't
- Header hover color dropped: the header is now a column (label + rule); click-to-fold still works.
- Priority view passes compact for all non-pinned rows (as shipped), so working/done rows there show
  squares, not chips; blocked always shows the hazard mark.
- A parent row keeps its own state's bar even when it sits in a more urgent section because of a sub-agent.
- Blocked/done chips not seen live (no such agents at shot time); verified by reading the code path.

## For other mods to match
- Chip: h16, px6, Chakra Petch 600 10.5px; cut 4px top-left; blocked stripes `blocked+"55"`, width 2, interval 6.
- Status squares: 6×6, `rounded(0)`; idle hollow 1px.
- Section rule: 1px `border` + 24px `accent` lead segment.

## v2
- Section numbering: `//01`, `//02`… (Share Tech Mono 9px `dim`) before every group label, in display order
  (Pinned, priority sections, or space groups: whatever comes first is //01).
- Corner brackets: `bracket(t, side)`, 1px `accent` L in an absolute 8×8 box, on the title row's top-left/top-right.
- v1 blocked fix kept (solid red chip + row tint; only the stripes blink).

## v3: scan card
- Hover a wide row for 400ms → a `SCAN // 0x01F` card beside the sidebar. Built on a controlled `Popup` (not
  `HoverCard`): `on_hover` arms a 400ms `acx.timer.after` (init's AsyncContext), hover-out drops it. HoverCard keeps itself
  open while the pointer is on the card; the brief wants it to close on leaving the row, so Popup + our own state.
- Placement: the Popup's trigger is a 1×1 div at `right(-10)` of the row, `anchor("top_left")`, so the card opens just
  right of the sidebar at row height and never covers a row. Not on the narrow rail (rail rows don't arm, and only wide rows draw it).
- Card: 260px, accent `paint_path` cut (10px) + `raised` cut (9px) inset 1 = 1px accent edge that follows the cut;
  brackets at top-right / bottom-left / bottom-right (inset 4). Rows: CLASS, STATUS (state word in state color),
  UPTIME, TURNS, DISTRICT, PATH (`~`, cut from the left at 30 chars), BRANCH; THREAT = 5 segments (blocked 5 red,
  done 3 yellow, working 2 cyan, idle 1 dim).
- Data: `terminals()` items carry **`created_ms`** (UPTIME) and **`turn`** (TURNS); cwd/branch come from `panes()`.
  Full key list seen live: address argv cols created_ms cwd die_with_parent exit_code finished_ms foreground identity
  keep labels name notify parent pid reason reported rm rows screen signal state records status_ms template title turn
  status program report.
- Sweep: 1px `working` line drawn at top 0; the card's first `on_size_change` sets its target to the bottom and
  `.transition("top", 250ms linear)` carries it; a 290ms timer removes it. Anim off: never set, never drawn.
- Gotcha: `agents()` can be empty in `init` right after a reload, so don't seed per-agent state there.
- Not seen live: real hover and the sweep in motion (no pointer control). Shot `research/v3-shots/cyberneon-agents-scan.png`
  is a forced-open debug render with the line parked mid-card; the debug code is removed.

## v5 telemetry
- Scan card gets `//TELEMETRY` above THREAT: MODEL, then CONTEXT / 5H / 7D as 8-segment bars + % (Share Tech Mono),
  reset `⟳1h24m` in `dim`, `ACCOUNT-WIDE` note under 5H/7D. Bar tone: <50 `working`, 50–80 `done`, >80 `blocked`.
- Source: the agent's own Claude Code status line. On card open (`arm` → `readUsage`), one `exec("hc", ["read", addr])`
  via `acx.spawn`, 5s timeout; `hc read` has no tail flag (`--lines` adds history above), so the last 8 non-trailing
  lines are parsed. Cached per address 20s in `this.tele`; no polling, nothing sent to the terminal. Remote
  `machine/tN` works as-is (checked on a remote Codex agent).
- Parser: `telemetry.js` (pure, last match wins), check: `node mods/cyberneon-agents/telemetry.check.mjs`.
  `ctx --` (fresh session) → CONTEXT row hidden; any missing field hides its row.
- No flicker: while loading (`SCANNING…`) the block reserves `min_h(78)`, the full block's height. The card grows
  ~100px; Popup keeps it clear of window edges (seen: a bottom row's card shifted up, fully on screen).
- Not done live: real hover (no pointer API; moving the user's mouse is off-limits). `research/v5-shots/scan-usage.png`
  is a forced-open debug render (installed copy only, removed after).

## v5 threat (combined)
- `threat(status, ctx, blockedMs)` in `telemetry.js`, checked in `telemetry.check.mjs`.
  Base by state: idle 1, working 1, done 2, blocked 3. Context ≥60% +1, ≥80% +2. Blocked ≥5 min +1, ≥15 min +2.
  Clamped 1..5. Tone: 1 dim, 2 working, 3 done, 4-5 blocked.
- Context comes from the card's //TELEMETRY read (so it lifts once that lands); blocked time from `since(a)`
  (this mod's own stamp of the last state change, so it restarts at 0 after a mod reload).
- A dim line under the bar says what raised it (`CTX 82% · WAIT 12M`); none when it's just the state.

## v5 telemetry: Codex
- Codex's footer (`GPT-6.1 Terra medium Fast · <path> · Context 87% left · weekly 69% left`) reports what is LEFT;
  `telemetry()` turns it into % used (ctx 13, 7D 31) so the bars mean the same for both agents. `weekly` → 7D,
  `5h limit N% left` → 5H (only shown by Codex near that limit, so 5H is usually absent and its row hides).
- A line with "% left" is parsed only as Codex, so Claude's 5h rule can't misread "5h limit 80% left".
- No reset times in Codex's footer, so 7D has no ⟳. Checked against two live Codex agents on a remote machine.
