# cyberneon-toast — v2 notes

## Changed (clone of shipped `toast` 0.1.15; click/action/dismiss/login-copy logic kept)
- Card: `raised` fill painted with `paint_path` (12px top-left 45° cut, % coords) plus a 1px `accent`
  stroke of the same polygon. Root fill is `background` so the cut reads (`raised` == `popover` in our theme).
  Hover swaps the fill to `hover` (via `on_hover` state, since a painted fill can't use `.hover()`).
- Tag on top: Chakra Petch 600 10.5px caps, h16 px6, `solid_foreground` text. By `level`:
  success → `TASK COMPLETE` on `solid`; warning → `INPUT REQUIRED` on `blocked`; error → `ERROR` on `blocked`;
  anything else → `NOTICE` on `solid`. The notification icon (if any) sits next to the tag.
- Title Rajdhani Bold 15 `foreground`; body 12 `foreground`. Login toast: command in Share Tech Mono `muted`,
  square bordered `COPY`/`COPIED` button (stop_propagation kept).
- Data line at the bottom: `HH:MM:SS // 0x01F`, Share Tech Mono 9 `dim` @0.7, truncates. Time = when this toast
  first rendered (`init`). Hex = a `t<hex>` terminal id found in `action.args`, else the overlay id's digits.
- `mod.json` gets `overlay: {width: 360, height: 96}` so the card fits four lines.

## Motion
- Slide-in: the card is drawn at `left = width` first; the root's first `on_size_change` sets it to 0 and
  `.transition("left", 180ms ease-out)` slides it in. Flicker: two one-shot `cx.timer.after` (200ms → opacity 0.3,
  260ms → 1) with `.transition("opacity", 40ms)`; then it holds. Timers only flip state twice; motion is native.
- Animations off (`shared("cyberneon.animations") === false`): phase forced to `hold`, so the card renders at
  left 0, opacity 1; no timers are set.

## Couldn't / caveats
- Which `level` Herdr uses for its own agent toasts isn't documented; done → success and needs-you → warning is
  inferred (the shipped toast colors them done / working). A plain `notify({level:"warning"})` also says INPUT REQUIRED.
- No safe way to post a real notification. The shot is `herdr-app do mod.open {"name":"cyberneon-toast"}`
  (empty props → NOTICE, no title), closed again by the same command. Whether toasts honor the mod.json overlay
  size, and stacking, are Herdr's side and unchanged; not seen live.
- Install: `rm -rf` was denied, so `cp -R mods/cyberneon-toast/. ~/.config/herdr-app/mods/cyberneon-toast/`.

## Fix: tag from the title first
- Herdr's "Claude Code needs you" toast comes as level `error`, so it read ERROR. `kind()` now matches the title/body words first and only then uses `level` (seen in the release demo, 2026-11-13).
