# cyberneon-new-menu — notes

## v3
- Frame: same as cyberneon-menu (`frame: "none"` in mod.json, 250×512 = the tabs opener's size; cut 10px, bracket bottom-right).
- Header `NEW // SESSION`, Share Tech Mono 9px `accent`.
- Rows: square, 26px, Rajdhani SemiBold 13px. Hover = `working` 15% band + 1px border + `▸` (tracked with `on_hover` in `this.hot`;
  disabled rows don't light up). Agent icons kept. Hints (shortcut, 1–9, "not installed") Share Tech Mono 10px `dim`.
- "Start an agent" label → `//01 START AN AGENT`; the bottom block gets `//02 WORKSPACE`. Both after a 1px `border` rule with a 24px `accent` lead.
- Height formula re-based on 26px rows: `min(491, 192 + n*26)`.
- Fade-in 120ms like cyberneon-menu; off with `cyberneon.animations === false`.
- No destructive rows here, so no `blocked` text.

## Behavior
Items, actions, digit keys 1–9, close-on-click unchanged. This menu has no arrow-key selection (shipped had none).
