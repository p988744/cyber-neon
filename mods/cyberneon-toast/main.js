// How notifications look. Anything can post one with notify({ title, body,
// level, icon, action }); replace this mod to restyle them all. Click to
// run its action (e.g. go to the agent) and dismiss it.
// Cyberneon: an in-game-style card — cut top-left corner, tag on top, data line at the bottom.

import { View, div, image, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, run, theme, shared } from "herdr";

const TAG = {
  success: ["TASK COMPLETE", "solid"],
  warning: ["INPUT REQUIRED", "blocked"],
  error: ["ERROR", "blocked"],
};
// Herdr's own agent toasts don't send success/warning (seen live: "Claude Code finished" came as NOTICE),
// so fall back to the title. ponytail: English title match; a localized Herdr would need its words here.
// The title wins over the level: Herdr's own "Claude Code needs you" comes as level "error" (seen in the demo).
function kind(p) {
  const s = `${p.title ?? ""} ${p.body ?? ""}`;
  if (/needs you|needs input|waiting|approval|permission|blocked/i.test(s)) return TAG.warning;
  if (/finished|done|complete/i.test(s)) return TAG.success;
  return TAG[p.level] ?? ["NOTICE", "solid"];
}
const CUT = 12;
const card = () => PathBuilder.fill()
  .add_polygon([[CUT, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, CUT]], true).build();
const edge = () => PathBuilder.stroke(1)
  .add_polygon([[CUT, 0.5], ["100%", 0.5], ["100%", "100%"], [0.5, "100%"], [0.5, CUT]], true).build();
const layer = (path, bg) => globalThis.window.paint_path(path, bg).absolute().top(0).left(0).size_full();
const pad = (n) => String(n).padStart(2, "0");

// Hex ID from real data: a terminal id in the action args (t1f → 0x01F), else the overlay id's digits.
function hexId(p) {
  const term = Object.values(p.action?.args ?? {}).find((v) => typeof v === "string" && /^t[0-9a-f]+$/i.test(v));
  if (term) return "0x" + term.slice(1).toUpperCase().padStart(3, "0");
  const n = parseInt(String(p.overlay ?? "").replace(/\D/g, "") || "0", 10);
  return "0x" + (n & 0xfff).toString(16).toUpperCase().padStart(3, "0");
}

export default class Toast extends View {
  init() {
    const d = new Date();
    this.time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    this.phase = "off"; // off (right of the frame) → in (slid) → flick (dim) → hold
    this.w = 0;
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const anim = shared("cyberneon.animations") !== false;
    const login = /^([a-z0-9][a-z0-9_.-]{0,31}) needs login; run hc machine login \1$/.exec(p.body ?? "");
    const command = login ? `hc machine login ${login[1]}` : null;
    const [tag, tagBg] = kind(p);
    const phase = anim ? this.phase : "hold";
    return div()
      .id("toast")
      .size_full()
      .overflow_hidden()
      .bg(t.background)
      .on_size_change((size, cx) => {
        this.w = size.width;
        // Drawn off to the right first; moving the target now lets `.transition("left")` slide it in.
        if (this.phase === "off" && anim) {
          this.phase = "in";
          cx.timer.after(200, (cx) => { this.phase = "flick"; cx.notify(); });
          cx.timer.after(260, (cx) => { this.phase = "hold"; cx.notify(); });
          cx.notify();
        }
      })
      .child(v_flex()
        .id("toast-card")
        .absolute().top(0).h_full().w_full()
        .left(phase === "off" ? Math.max(this.w, 400) : 0)
        .transition("left", { duration: 180, easing: "ease-out" })
        .opacity(phase === "flick" ? 0.3 : 1)
        .transition("opacity", { duration: 40, easing: "linear" })
        .cursor_pointer()
        .on_hover((h, cx) => { this.hovered = h; cx.notify(); })
        .on_click(() => {
          if (p.action?.name) run(p.action.name, p.action.args ?? {});
          closeOverlay(p.overlay);
        })
        .child(layer(card(), this.hovered ? t.hover : t.raised))
        .child(layer(edge(), t.accent))
        // Three rows so it fits Herdr's toast height: tag + data line, title, body.
        .child(v_flex().size_full().pl(18).pr(12).pt(6).pb(4).gap(1)
          .child(h_flex().gap(8).items_center()
            .child(div().flex_none().h(16).px(6).flex().items_center().bg(t[tagBg])
              .font_family("Chakra Petch").font_weight(600).text_size(10.5).text_color(t.solid_foreground).child(tag))
            .when(Boolean(p.icon), (el) => el.child(image(p.icon).w(14).h(14).flex_none()))
            .child(div().flex_1().min_w(0).truncate().text_right().font_family("Share Tech Mono").text_size(9).text_color(t.dim).opacity(0.7)
              .child(`${this.time} // ${hexId(p)}`)))
          .child(div().truncate().font_family("Rajdhani").font_bold().text_size(14).text_color(t.foreground)
            .child(login ? `${login[1]} needs a login: run` : p.title ?? ""))
          .when(!login && Boolean(p.body), (el) => el.child(div().truncate().text_size(11).text_color(t.muted).child(p.body ?? "")))
          .when(Boolean(login), (el) => el.child(h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).truncate().tooltip(command).font_family("Share Tech Mono").text_size(11).text_color(t.muted).child(command))
            .child(div().id("toast-login-copy").flex_none().px(6).py(2).rounded(0).border(1).border_color(t.border)
              .font_family("Chakra Petch").font_weight(600).text_size(10.5).text_color(t.foreground).cursor_pointer()
              .hover((s) => s.bg(t.hover).border_color(t.accent))
              .on_click((_e, cx) => { cx.stop_propagation(); cx.write_to_clipboard(command); this.copied = true; cx.notify(); })
              .child(this.copied ? "COPIED" : "COPY"))))),
      );
  }
}
