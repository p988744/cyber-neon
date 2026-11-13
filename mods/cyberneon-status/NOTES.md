# cyberneon-status notes (v1)

## Changed
- Readout strip: Share Tech Mono 11px, segments split by `▮` in `border`.
- Left tag `NET//OK`: `accent` fill with a 9px top-left 45° cut (`paint_path`, % coords), Chakra Petch 700, `accent_foreground` text.
- Segments: machine (or "This computer"), branch (only when `space.branch` is set), `N AGENTS`, then one 6×6 square + count per state with count > 0
  (working/blocked/done filled in state color; idle a 1px hollow square per DESIGN §6; blocked count in `blocked` red).
- Clock `HH:MM` at the far right, from `cx.timer.every(30000)`; only notifies when the minute string changes.
- Kept: palette hint (bound key, click runs `app.palette`), now with a `muted` hover.

## Animation switch
- This mod has no animation at all, so `cyberneon.animations` has nothing to turn off. The timer is data (clock), not animation.

## Couldn't / skipped
- Branch is missing in the shot because herdr-gallery has no commits yet (`space.branch` is null); it shows when set.
- Install used `cp` over the files instead of `rm -rf` (rm was denied); same result for a single-file change.
- No blocked blink here: the agents list and pane header own that; a third blinking spot would break DESIGN §7.

## For other mods to match
- Status squares: `div().size(6).rounded(0)`, idle = `.border(1).border_color(t.idle)` hollow.
- Cut tag helper: `PathBuilder.fill().add_polygon([[c,0],["100%",0],["100%","100%"],[0,"100%"],[0,c]], true).build()` painted with
  `globalThis.window.paint_path(path, t.accent)` — passing a theme color directly works.
