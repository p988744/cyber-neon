# cyberneon-tabs — v1 notes

## Changed
- Tabs: square chips, 28px tall, Chakra Petch 600 at 12px, with a 6px top-left 45° cut.
  - How the cut works: the chip keeps its normal `.bg()`, so `.hover()` still works. A `paint_path` triangle in `chrome` covers the corner, then a `PathBuilder.stroke(1)` cut outline goes on top. No measuring needed (`%` coordinates).
  - Inactive: `muted` text, `chrome` fill (so it reads as no fill), `border` outline. Hover: `hover` fill.
  - Active: `foreground` text, `selected` fill, `accent` cut outline, and a 2px `done` line along the bottom.
- Status markers: 6×6 squares.
  - working: a `▰▱▱` bar in Share Tech Mono, `.frames` at 110ms. With animations off it's a still cyan square.
  - blocked: a hot-red square with a hard blink (opacity loop −6→7, linear, 900ms). With animations off it doesn't blink.
  - done: a yellow square.
  - idle: no marker, same as the shipped mod.
- The +, window, Files and Changes buttons are 26×26 square icon buttons with a 1px `border` outline.
  - Files and Changes lost their text labels. Each has a `.tooltip()` with its name instead.
  - When Files or Changes is on: `accent` outline plus a 2px `accent` underline.
- Animation switch: `const anim = shared("cyberneon.animations") !== false`. Both animations (frames and loop) only exist when `anim` is true.
- Logic unchanged: `syncPanel`, drag-to-reorder, rename (double-click), close, right-click menu, scroll-wheel, traffic-light padding.

## Couldn't / didn't
- The stroke on the right and bottom edges sits on the `100%` line, so half of its 1px may be clipped. At 2x it looks fine.
- Blocked tabs get no hazard stripes. At 6px the stripes wouldn't read, so the square blinks instead.

## For other mods to match
- Cut size is 6px for small chips. Use the same cap + stroke trick (see `cap`/`edge` in main.js) to keep hover fills.
- Active means `selected` fill with a `done` 2px bottom line. A toggle that is on means an `accent` outline and an `accent` 2px underline.
- Working bar frames: `["▰▱▱","▱▰▱","▱▱▰"]` at 110ms.

## v2: title decode
- A tab seen for the first time by this mod copy, or retitled, decodes over 300ms: noise glyphs from `#%&@01<>/\`
  under a cover whose left edge slides right with a native `.transition("left", 300ms linear)`; the glyph layer
  counter-slides so glyphs stay put. Real text always lays out underneath, so tab width never changes.
- Why not padded `.frames`: **`.frames` runs on one clock shared by every view, and its phase can't be read from JS**
  (tested: a new element started at frame 244 of 3000; performance.now()/Date.now() don't match). A padded one-shot
  list therefore usually starts in the padding and shows nothing. Noise doesn't care about phase; the slide does,
  and `.transition` is a real one-shot. chrome's typing (`TYPE` padded frames) likely has the same problem.
- Two one-shot timers flip state (start the slide at 30ms, drop the cover at 380ms). Timers must come from `init`'s
  AsyncContext (`this.acx`); render's `cx` is only valid for that call.
- Gotcha: wrapping a `.truncate()` div in a block/flex `overflow_hidden` parent collapsed it to 0 width. Hang the
  absolute cover directly on the truncating div instead.
- Animations off: no cover, plain text. Cover bg = tab bg (`selected`/`chrome`); hover during the 300ms isn't matched.

## v3 (from v3-jobs)
- Third panel button `jobs` (tooltip `Jobs`, icon `jobs.svg`: a square target with a filled center and four ticks),
  same toggle as Files/Changes. `enabled` = `shared("workspace.panels") ?? ["files","changes"]` with `"jobs"` always added.
