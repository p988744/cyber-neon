import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, spaces, panes, knownAgents, run, openOverlay, closeOverlay, props, window, keys, shared, setShared } from "herdr";

// The last agents each machine reported, shown at once while knownAgents() checks again.
const KNOWN = "new-menu.agents";

// Cyberneon frame (mod.json overlay frame: "none"), same technique as cyberneon-picker.
const W = globalThis.window; // herdr also exports window()
const anim = () => shared("cyberneon.animations") !== false;
const CUT = 10;
const cutPath = (c) => PathBuilder.fill().add_polygon([[c, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, c]], true).build();
const MONO = "Share Tech Mono";

function shortcut(name) {
  const k = keys().find(b => b.section === "global" && b.action === name);
  if (!k?.keys.trim()) return "";
  const mac = window()?.platform === "macos";
  const names = mac ? { ctrl: "⌃", alt: "⌥", shift: "⇧", cmd: "⌘", fn: "fn" } : { ctrl: "Ctrl", alt: "Alt", shift: "Shift", cmd: "Super", fn: "Fn" };
  const alias = { secondary: mac ? "cmd" : "ctrl", super: "cmd", win: "cmd" };
  return k.keys.trim().split(/\s+/).map(stroke => {
    const parts = stroke.split("-");
    let key = parts.pop();
    if (key === "") { key = "-"; parts.pop(); }
    const held = new Set(parts.map(m => alias[m.toLowerCase()] ?? m.toLowerCase()));
    if (/^[A-Z]$/.test(key)) held.add("shift");
    const label = key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1).toLowerCase();
    return [...Object.keys(names).filter(m => held.has(m)).map(m => names[m]), label].join(mac ? "" : "+");
  }).join(" ");
}

export default class NewMenu extends View {
  init(_props, cx) {
    const machine = spaces().find(s => s.active)?.machine;
    const where = machine ?? "";
    this.agents = shared(KNOWN)?.[where] ?? [];
    this.handle = cx.focus_handle();
    this.handle.focus();
    // 120ms fade-in: first frame at 0, the native transition carries it to 1.
    this.shown = !anim();
    if (!this.shown) cx.timer.after(16, () => { this.shown = true; cx.notify(); });
    cx.spawn(async cx => {
      try {
        this.agents = await knownAgents({ on: machine });
        setShared(KNOWN, { ...shared(KNOWN), [where]: this.agents });
      }
      catch { this.failed = true; }
      cx.notify();
    });
  }
  row(id, icon, name, action, hint = "", enabled = true) {
    const t = theme();
    const on = enabled && this.hot === id;
    return h_flex().id(id).h(26).px(6).gap(7).rounded(0).items_center().flex_none().font_semibold()
      .border_1().border_color(on ? t.working : "#00000000").when(on, el => el.bg(t.working + "26"))
      .text_color(enabled ? t.foreground : t.dim)
      .on_hover((h, cx) => { const next = h ? id : this.hot === id ? null : this.hot; if (next !== this.hot) { this.hot = next; cx.notify(); } })
      .on_click(() => { if (enabled) { closeOverlay(props().overlay); action(); } })
      .child(div().w(8).flex_none().text_size(10).text_color(t.working).child(on ? "▸" : ""))
      .child(icon).child(div().flex_1().truncate().child(name)).child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child(hint));
  }
  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const installed = this.agents.filter(a => a.installed);
    const choices = this.failed ? installed : [...installed, ...this.agents.filter(a => !a.installed).slice(0, 2)];
    const title = (num, label) => h_flex().h(18).px(8).pt(2).gap(6).items_center().flex_none()
      .child(div().font_family(MONO).text_size(9).text_color(t.dim).child(num))
      .child(div().font_family("Chakra Petch").font_semibold().text_size(9).text_color(t.dim).child(label));
    const rule = () => div().relative().mx(4).my(4).h(1).flex_none().bg(t.border)
      .child(div().absolute().top(0).left(0).w(24).h(1).bg(t.accent));
    return v_flex().relative().min_h(0).w_full().h(Math.min(491, 192 + Math.max(1, choices.length + (this.failed ? 1 : 0)) * 26)).p(6).text_size(13)
      .id("new-menu").track_focus(this.handle)
      .opacity(this.shown ? 1 : 0)
      .when(anim(), el => el.transition("opacity", { duration: 120 }))
      .child(W.paint_path(cutPath(CUT), t.accent).absolute().top(0).left(0).size_full())
      .child(W.paint_path(cutPath(CUT - 1), t.popover).absolute().top(1).left(1).right(1).bottom(1))
      .child(div().absolute().size(8).bottom(3).right(3).border_b(1).border_r(1).border_color(t.accent))
      .child(div().h(20).pl(12).flex_none().font_family(MONO).text_size(9).text_color(t.accent).child("NEW // SESSION"))
      .on_key_down((e) => {
        if (e.modifiers.control || e.modifiers.platform || e.modifiers.alt) return;
        const agent = /^[1-9]$/.test(e.key) ? installed[Number(e.key) - 1] : null;
        if (!agent) return;
        closeOverlay(props().overlay);
        run("tab.new", { name: agent.name, space: space?.id, argv: agent.run });
      })
      .child(this.row("terminal", svg("icons/shell.svg").size(14), "Terminal", () => run("tab.new", { space: space?.id }), shortcut("tab.new")))
      .child(rule())
      .child(title("//01", "START AN AGENT"))
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar()
        .children(choices.map((a, i) => this.row(a.key, a.tint ? svg(a.icon).size(14).text_color(t.foreground) : image(a.icon).size(14), a.name,
          () => run("tab.new", { name: a.name, space: space?.id, argv: a.run }), a.installed ? (i < 9 ? String(i + 1) : "") : "not installed", a.installed)))
        .when(this.failed || this.agents.length === 0, el => el.child(div().px(9).py(6).font_family(MONO).text_size(10).text_color(t.dim).child(this.failed ? "Could not check installed agents" : "Checking installed agents…"))))
      .child(rule())
      .child(title("//02", "WORKSPACE"))
      .child(this.row("space", div().w(14).child("+"), "New space", () => run("space.new"), shortcut("space.new")))
      .child(this.row("worktree", svg("mods/workspace-chrome/branch.svg").size(14), "New worktree…", () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "new" } }), "", Boolean(space)))
      .child(this.row("worktree-open", svg("mods/workspace-chrome/branch.svg").size(14), "Open worktree\u2026", () => openOverlay({ mod: "worktree", kind: "dialog", width: 560, height: 480, props: { space: space?.id, folder: panes().find(p => p.focused)?.cwd, action: "open" } }), "", Boolean(space)));
  }
}
