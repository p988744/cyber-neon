# cyberneon-pane — notes (v1)

## Changed (restyle only; logic of the shipped `pane` kept)
- Left: 3px strip in `theme()[status]` (`border` when no agent), plus a 7px top-left 45° notch in `accent` (`paint_path` triangle, `%` coords).
- Title: icon, name in Rajdhani Bold 13px (case kept), folder in `muted`, branch in Share Tech Mono 11px `muted` (shown only when `p.branch`).
- Right: state chip, Chakra Petch 600 10px, square, 16px high:
  - working `EXEC` + cyan 1px border + `▰▱▱▱` data bar (`.frames`, 110ms)
  - blocked `INPUT REQ`: `blocked`+26 fill, `pattern_slash("#FF003C55",2,7)`, hard blink (opacity −6→7 linear, 900ms)
  - done `COMPLETE`: `done` fill, `solid_foreground` text, breathe 0.6→1 / 1400ms
  - idle `STANDBY`: 6×6 hollow square in `idle`
- Buttons (split right/down, zoom/unzoom, close): 20×20 square, 1px `border`, hover → `hover` bg + `accent` border. Still hover-only, as shipped.
- Focused: text at full opacity, 1px `working` line between header and terminal (top/bottom header both handled). Unfocused: text group at 0.6 opacity, line `border`.
- Click to focus, `stop_propagation` on buttons, bottom-header detection: unchanged.

## Animation switch
`anim = shared("cyberneon.animations") !== false`; every `.frames`/`.loop` is behind `.when(anim, …)`.
With it off, chips are static (EXEC shows `▰▱▱▱`).

## Couldn't / didn't
- Rename: the shipped `pane` header has no rename control (rename lives in the terminal menu), so nothing to keep.
- Pane frame corners stay square; the notch only lives in the header strip.

## Gotchas for the other mods
- `flex_shrink()` **needs a number** (`flex_shrink(1)`). Without it `herdr-app check` passes
  (check never renders with real pane props) but the live render throws:
  "This view could not be re-rendered".
- That banner is sticky: after fixing, run `herdr-app do layout.switch '{"name":"Cyberpunk-Neon"}'`
  to force a fresh render, and take two shots (the first can be stale).
- To see the real error, temporarily wrap `render` in try/catch and render `String(e.stack)`.
- Shots catch blinking chips mid-fade; shoot twice before judging.
- Chip look (heights, font, state hexes) is the pattern agents/tabs could match.

## v2
- Data label `0x005 // P1` before the chip: Share Tech Mono 9px `dim` @0.7. Hex = terminal id after `t` read as hex
  (`t1f` → `0x01F`); `P<n>` = position among `panes()` of the same tab. Hidden under 420px header width
  (width from `on_size_change` on the header; it only notifies when crossing 420).
- Corner brackets (focused pane only): two absolute 8×8 `div`s at right top/bottom, 1px `accent` `border_t/b + border_r`.
- Scan sweep: module-level `seen` Set of pane ids. First render of an unseen pane (with animations on) draws a 1px
  `working` line at left 0; the header's first `on_size_change` moves its target to the right edge, and
  `.transition("left", {duration: 300, linear})` carries it across. `cx.timer.after(340)` then removes it
  (the timer stops the effect; the motion itself is native). Panes present at mod load sweep once on load/hot-reload.
- Not seen live: the sweep (needs a new pane; briefs say don't open panes). Verified by reading the code path.
- Animations off: no sweep (`anim` gates both setting `sweep` and drawing it). Label and brackets are static.
- Tip for others: `.transition` + changing the target in `on_size_change` is a way to get a one-shot motion that
  starts at a known phase; `.loop` runs on a shared clock, so its phase on first draw is not 0.
