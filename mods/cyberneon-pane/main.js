// Cyberpunk-Neon pane header (clone of the shipped `pane`), for layouts that frame their panes:
//   { "tab": "active", "pane": { "header": { "content": { "mod": "cyberneon-pane" } } } }
// Left: 3px state strip + accent notch. Then icon, name, folder, branch. Right: state chip
// (DESIGN.md §6) and, on hover, split/zoom/close. Props from the app: { pane, terminal }.
// Click: focus the pane.

import { View, div, svg, image, PathBuilder, Background } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, props, run, theme, home, layout, shared } from "herdr";

const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
// Top-left 45° notch: a triangle filling its square box.
const NOTCH = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("0%", "100%").close().build();
const layer = (path, bg) => globalThis.window.paint_path(path, bg).absolute().top(0).left(0).size_full();
const BAR = ["▰▱▱▱", "▰▰▱▱", "▰▰▰▱", "▰▰▰▰", "▱▰▰▰", "▱▱▰▰", "▱▱▱▰", "▱▱▱▱"];

// Match the first visible tab frame, including the active child of a stack.
function paneFrame(node) {
  if (!node || node.hidden) return null;
  if (node.content?.tab && node.content.pane) return node.content.pane;
  let children = node.children ?? [];
  if (node.type === "stack") {
    const visible = children.filter(child => !child.hidden);
    children = [visible.find(child => child.id === node.active) ?? visible[0]];
  }
  for (const child of children) {
    const frame = paneFrame(child);
    if (frame) return frame;
  }
  return null;
}

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// Panes this mod copy has already drawn: only a new one gets the scan sweep.
const seen = new Set();

// `t1f` → `0x01F`; pane index within its tab → `P2`.
function dataLabel(p) {
  const n = parseInt(String(p.terminal ?? "").replace(/^t/, ""), 16);
  const hex = Number.isNaN(n) ? null : "0x" + n.toString(16).toUpperCase().padStart(3, "0");
  const i = panes().filter(q => q.tab === p.tab).findIndex(q => q.pane === p.pane);
  return [hex, i >= 0 ? `P${i + 1}` : null].filter(Boolean).join(" // ");
}

const bracket = (color, corner) => div().absolute().right(0).size(8).border_color(color).border_r(1)
  .when(corner === "top", el => el.top(0).border_t(1))
  .when(corner === "bottom", el => el.bottom(0).border_b(1));

export default class Pane extends View {
  init() { this.hovered = false; this.w = 0; this.sweep = null; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .size(20)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(0)
      .border(1)
      .border_color(t.border)
      .text_color(t.muted)
      .hover((s) => s.bg(t.hover).border_color(t.accent).text_color(t.foreground))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/cyberneon-pane/${icon}.svg`).size(12));
  }

  // State chip (DESIGN.md §6). Every motion sits behind `anim`.
  chip(t, st, anim) {
    const base = () => div().flex_none().h(16).px(6).flex().items_center().gap(4).rounded(0)
      .font_family("Chakra Petch").font_semibold().text_size(10);
    if (st === "working") return base().border(1).border_color(t.working).text_color(t.working)
      .child("EXEC")
      .child(div().font_family("Share Tech Mono").child(BAR[0]).when(anim, el => el.frames(BAR, 110)));
    // Solid red chip that never disappears; only the dark stripes over it blink.
    if (st === "blocked") return base().relative().bg(t.blocked)
      .child(div().absolute().top(0).left(0).size_full()
        .child(layer(RECT(), Background.pattern_slash("#0a0b0f59", 2, 7)))
        .when(anim, el => el.loop("opacity", { from: -6, to: 7, period: 900, easing: "linear" })))
      .child(div().relative().font_bold().text_color(t.solid_foreground).child("INPUT REQ"));
    if (st === "done") return base().bg(t.done).text_color(t.solid_foreground)
      .child("COMPLETE")
      .when(anim, el => el.loop("opacity", { from: 0.6, to: 1, period: 1400 }));
    if (st === "idle") return base().text_color(t.idle)
      .child(div().size(6).border(1).border_color(t.idle))
      .child("STANDBY");
    return null;
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const name = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const lit = p.focused;
    const pic = icon(p.program, 14, lit ? t.foreground : t.dim);
    const st = p.status;
    const pane = p.pane;
    const anim = shared("cyberneon.animations") !== false;
    const strip = (st && t[st]) || t.border;
    const chip = this.chip(t, st, anim);
    const bottom = paneFrame(layout())?.header?.position === "bottom";
    if (!seen.has(pane)) { seen.add(pane); if (anim) this.sweep = "start"; }
    const data = this.w >= 420 ? dataLabel(p) : "";
    return h_flex()
      .id(`pane-head-${pane}`)
      .relative()
      .size_full()
      .pr(8)
      .gap(8)
      .items_center()
      .bg(t.background)
      // blocked: the whole strip is tinted red and its edge line turns red
      .when(st === "blocked", el => el.bg(t.blocked + "26"))
      .when(bottom, el => el.border_t(1))
      .when(!bottom, el => el.border_b(1))
      // focused: 1px working-cyan line between header and terminal
      .border_color(st === "blocked" ? t.blocked : lit ? t.working : t.border)
      .text_size(12)
      .on_hover((hovered, cx) => { this.hovered = hovered; cx.notify(); })
      .on_size_change((size, cx) => {
        const wide = (size.width >= 420) !== (this.w >= 420);
        this.w = size.width;
        // The sweep element was drawn at left 0; moving its target now lets `.transition` carry it across.
        if (this.sweep === "start") {
          this.sweep = "go";
          cx.timer.after(340, (cx) => { this.sweep = null; cx.notify(); });
          cx.notify();
        } else if (wide) cx.notify();
      })
      .on_click(() => run("pane.focus", { pane }))
      .child(div().w(3).h_full().flex_none().bg(strip))
      .child(div().absolute().top(0).left(3).size(7).child(layer(NOTCH(), t.accent)))
      .child(h_flex().flex_1().min_w(0).gap(8).items_center().opacity(lit ? 1 : 0.6)
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().flex_none().truncate().max_w(260).font_family("Rajdhani").font_bold().text_size(13)
          .text_color(lit ? t.foreground : t.muted).child(name))
        .child(div().flex_shrink(1).min_w(0).truncate().text_color(t.muted).child(folder(p.cwd)))
        .when(Boolean(p.branch), el => el.child(div().flex_shrink(1).min_w(0).truncate()
          .font_family("Share Tech Mono").text_size(11).text_color(t.muted).child(p.branch))))
      .when(Boolean(data), el => el.child(div().flex_none().font_family("Share Tech Mono").text_size(9)
        .text_color(t.dim).opacity(0.7).child(data)))
      .when(Boolean(chip), el => el.child(chip))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })))
      .when(lit, el => el.child(bracket(t.accent, "top")).child(bracket(t.accent, "bottom")))
      // One-shot scan: a 1px working line crosses the header once (~300ms), then is removed.
      .when(anim && this.sweep !== null, el => el.child(div().id(`ph-sweep-${pane}`).absolute().top(0).h_full().w(1)
        .bg(t.working).left(this.sweep === "go" ? Math.max(0, this.w - 1) : 0)
        .transition("left", { duration: 300, easing: "linear" })));
  }
}
