# cyberneon-picker — notes (v2)

## Changed (restyle only; rows(), go(), keys, scroll math of the shipped `picker` kept)
- Frame: `mod.json` overlay has `"frame": "none"`. The panel is two `paint_path` fills with % coords:
  the outer one in `accent` with a 12px top-left cut, then an inner one in `popover` with an 11px cut, inset 1px.
  That gives a 1px accent border that follows the cut, with no half-clipped strokes.
  Corner brackets: 8×8 `accent` `div` borders at top-right, bottom-left and bottom-right, inset 4px. Top-left has the cut.
- Header (one 36px row with an accent bottom rule): `ACCESS POINT //` and the search input, both Share Tech Mono.
  Then the readout `00:NN` (Share Tech Mono 18px) = number of matching tabs: `working` cyan, or `blocked` red at 0.
  Then a square `ESC` button (still closes on click).
- Buffer row: `//01 BUFFER` (9px dim 0.7), 6 square slots (24×18, 1px `border`).
  Typed char i fills slot i with `CODES[charCode % 6]` in `working`. This is decoration only. `MATCH//TABS` sits at the right.
- Code column: each pickable row (tab, "earlier", new tab, new space) starts with `CODES[index % 6]`,
  `["1C","55","BD","E9","7A","FF"]`, Share Tech Mono 12px. It is `dim`, or `working` on the selected row.
- Selected row: `working` + "26" fill (about 15%) and a 1px `working` border. Others: a transparent 1px border, so nothing shifts. Hover uses `hover`.
  All rows are square. Space badges are square.
- Status glyphs are now 6×6 squares: working/blocked/done filled in the state color, idle hollow, none = `border`.
  The spinner was dropped because speed matters more than effects here.
- Fade-in: the root starts at opacity 0. `cx.timer.after(16)` sets `shown`, and `.transition("opacity", {duration:150})` carries it to 1 natively.

## Animation switch
`anim()` = `shared("cyberneon.animations") !== false`. When it's off, `init` sets `shown = true` (no timer), and render
adds no `.transition`, so the picker appears at once. There is no other motion in this mod.

## Couldn't / caveats
- Install: `rm -rf` on the installed folder was denied, so I used `cp -R ./. ~/.config/herdr-app/mods/cyberneon-picker/`.
- Hover and keyboard moves weren't exercised live (I opened and closed it with `herdr-app do mod.open:cyberneon-picker`).
  Key handling is byte-for-byte the shipped code.
- The bottom row at the 320px list edge is clipped mid-row. That's the shipped scroll behavior, kept as is.

## For other mods to match
- Cut border without stroke clipping: accent `cutPath(c)` at size_full, then popover `cutPath(c-1)` at `top/left/right/bottom(1)`.
- Selection band: `working+"26"` fill + 1px `working` border; give unselected rows a transparent 1px border.
