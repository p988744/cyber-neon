# cyberneon-menu — notes

## v3
- Frame: `mod.json` overlay `"frame": "none"` (plus 200×260 so `mod.open` previews like the space opener).
  Verified: the mod.json frame applies even when cyberneon-tabs/spaces call `openOverlay` without `frame`.
  Panel = picker technique: accent `cutPath(10)` at size_full, popover `cutPath(9)` inset 1px, 8px accent bracket bottom-right.
  The panel is content-sized (`w_full`, no height), so a tall popup leaves transparent space below it, not an empty panel.
- Rows: square, 26px, Rajdhani SemiBold 13px. Selected: `working`+"26" fill, 1px `working` border, `▸` marker; others keep a transparent border.
  Icons kept (13px, `muted`, `working` when selected). Shortcut hints Share Tech Mono 10px `dim`.
  Destructive (`*.close`, worktree remove) in `blocked`.
- Groups split exactly where the shipped separators were. Separator = 1px `border` with a 24px `accent` lead.
  Titles: `//NN` (Share Tech Mono 9px) + Chakra Petch 600 9px `dim`: scope name (TAB/SPACE/PANE/GLOBAL), TERMINATE, SYSTEM, THEME.
- Fade-in 120ms: `shown` set by `cx.timer.after(16)`, `.transition("opacity")`. Anim off: `shown` starts true, no transition.

## Behavior
- Items, actions, ↑/↓/Enter/Esc unchanged. One change: hovering a row now moves the keyboard selection to it
  (`on_hover`), so hover and keys share one band. Shipped had a separate hover tint.
