# cyberneon-chrome — v1 notes

## Changed
- Brand: Herdr logo + name replaced by an original `CYBER//NEON` wordmark (Rajdhani Bold 19, `accent`)
  plus `v0.1` (Share Tech Mono 10, `dim`). Nothing is drawn from any game logo.
- RGB-split glitch: a `working` (cyan) copy at left −2 and a `blocked` (hot red) copy at left +2 sit behind
  the accent word. Both share `.loop("opacity", {from:-40, to:1.5, period:3000, linear})`, so they're
  visible ~100 ms once per 3 s. It's the only always-on animation. With animations off the copies aren't rendered at all.
- Search / sidebar-fold: square 26px icon buttons, 1px `border`, hover → `hover` bg + `accent` border.
- Footer: Settings / Add machine are Chakra Petch 600 12px caps labels with 18px square bordered icon boxes;
  the update-ready dot is a 6×6 square.
- Animation switch: footer chip `ANIM ON` / `ANIM OFF` (Share Tech Mono) calls
  `setShared("cyberneon.animations", !on)`, where `on = shared(...) !== false` (undefined = on).
  Filled accent square = on, hollow `dim` square = off.
- Window drag, toggleSidebar, picker, app.settings, machine-add, macOS traffic-light padding: unchanged.

## Couldn't / caveats
- The layout gives the brand 46px, not the 52px in the brief; layouts/ isn't mine to edit.
- 60px footer fits only two rows on the narrow rail, so the ANIM chip shows on the wide sidebar only.
- Gotcha: `.line_height(22)` made the text vanish (it seems to be read as a multiplier). Don't pass a
  plain px number to line_height.

## For other mods
- Read the switch exactly like this: `const animOn = () => shared("cyberneon.animations") !== false;`
  `setShared` re-renders every mod (AGENTS.md), so reading it in render is enough.
- Glitch/flick recipe: an opacity loop far below 0 (from −40 to 1.5, linear) gives a short pulse once per period.
- Use theme names for glitch colors: `working` = cyan, `blocked` = hot red.

## v2
- Hazard band: 4px absolute strip at the brand's bottom edge (full width, also on the rail): `solid` fill +
  `pattern_slash("#0a0b0f59", 2, 6)`, both via `paint_path` on a % RECT (`.bg()` takes only colors). Brand row got `pb(4)`.
- Barcode: 14 fixed [bar, gap] pairs (1–3px), 10px tall, `dim`, after `v0.1`. Data line `SYS//0x7F3A  NODE//<machines().length>`,
  Share Tech Mono 9px `dim` 0.7, truncates. Both live in the wide-only block, so the rail drops them; the block is
  `min_w(0).overflow_hidden()`, so with the macOS 76px traffic-light pad the barcode clips before it crowds the buttons.
- Typing: module-level `typed` flag → brand types once per app start (and once per mod reload). `init` (brand copy only,
  anim on) sets `this.typing`; the word renders `.frames(TYPE, 40)` = "▌", "C▌" … "CYBER//NEON▌" (480ms) then 400 padded
  copies of the plain word; `cx.timer.after(700)` swaps in the static word + glitch. Glitch copies aren't drawn while typing.
- Anim off: `init` skips typing, and render re-checks `animOn()`, so nothing types or flicks.
- Typing not caught in a shot (it's over in 0.5s); verified by reading the code path.

## v3: typing rebuilt
- Typing no longer uses padded `.frames` (shared clock, unknown phase → it showed nothing). Now: the real word lays out,
  a `chrome` cover (`id("type-cover")`, 130px, overshoots the ~105px word) slides `left` 0→130 with a one-shot
  `.transition("left", 480ms linear)`, and a Rajdhani `▌` in `accent` sits at the cover's left edge. The wordmark is
  `overflow_hidden` while typing, so the overshoot is clipped and the width never changes (`v0.1` stays put). `init` timers:
  30ms → start the slide, 560ms → drop the cover and show the glitch copies (hidden until then).
- **Bug found (was in v2 too):** `init`'s first argument does not carry the layout props, so `p?.footer` was always
  falsy. The footer copy inits first and used up the module-level `typed` flag, so the brand never typed. Fixed by reading
  `props()?.footer` in `init`.
- When it runs (tested with an init log): a save reloads the mod and creates **new instances** (init runs again, the module
  is fresh) → the brand types. `layout.switch` to the **same** layout keeps the instances (no init). Switching away and
  back makes new instances, but the module flag is already used, so nothing types. That fits "once per app start".
- Proof: 60 back-to-back `herdr-app shot`s (~33ms apart) right after installing a save: C▌ … CYBER//NEON▌ over ~400ms,
  `research/v3-shots/cyberneon-chrome-typing-frames.png` + `-typing-mid.png`.
- Anim off: `init` returns early and render re-checks `animOn()`, so no cover, cursor or glitch.
