import { View, div, svg, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys } from "herdr";

const W = globalThis.window; // paint_path lives on the gpui window; herdr's window() is metadata
// Top-left 45° cut, % coords so no measuring (herdr-fit §1.1 A).
const CUT_TL = PathBuilder.fill().add_polygon([[9, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, 9]], true).build();
const STATES = ["working", "blocked", "done", "idle"];
const pad = (n) => String(n).padStart(2, "0");
const clock = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.time = clock();
    // Clock only; 30s keeps HH:MM at most 30s late. Not used for animation.
    cx.timer.every(30000, (cx) => { const t = clock(); if (t !== this.time) { this.time = t; cx.notify(); } });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const sep = () => div().text_color(t.border).child("▮");
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(12).text_color(t.dim)).child(text);
    const counts = STATES.map(s => [s, list.filter(a => a.status === s).length]).filter(([, n]) => n > 0);

    const tag = div().relative().h_full().px(10).pl(12).flex().items_center()
      .child(W.paint_path(CUT_TL, t.accent).absolute().top(0).left(0).size_full())
      .child(div().relative().font_family("Chakra Petch").font_weight(700).text_color(t.accent_foreground).child("NET//OK"));

    return h_flex().size_full().pr(14).gap(10).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .font_family("Share Tech Mono").text_size(11).text_color(t.muted)
      .child(tag)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(sep()).child(label("branch", space.branch)))
      .child(sep())
      .child(h_flex().gap(10).items_center()
        .child(div().text_color(t.foreground).child(`${list.length} AGENTS`))
        .children(counts.map(([s, n]) => h_flex().gap(4).items_center()
          .child(s === "idle" ? div().size(6).rounded(0).border(1).border_color(t.idle) : div().size(6).rounded(0).bg(t[s]))
          .child(div().text_color(s === "blocked" ? t.blocked : t.foreground).child(String(n))))))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).hover(s => s.text_color(t.muted)).on_click(() => run("app.palette")).child(this.hint(t)))
      .child(sep())
      .child(div().text_color(t.foreground).child(this.time));
  }
}
