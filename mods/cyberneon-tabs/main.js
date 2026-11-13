import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, ScrollHandle } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";

// Top-left 45° cut (DESIGN.md §5): a chrome-coloured cap hides the corner of the
// element's own bg (so .hover() still works), then the outline is stroked on top.
const CUT = 6;
const cap = (color) => globalThis.window.paint_path(PathBuilder.fill().add_polygon([[0, 0], [CUT, 0], [0, CUT]], true).build(), color)
  .absolute().top(0).left(0).size_full();
const edge = (color) => globalThis.window.paint_path(PathBuilder.stroke(1).add_polygon([[CUT, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, CUT]], true).build(), color)
  .absolute().top(0).left(0).size_full();
// Title decode: noise glyphs under a cover that slides off left to right (native transition).
// ponytail: .frames runs on one shared clock with an unknown phase, so a padded frames list can't
// be made to start at frame 0; noise doesn't care about phase, and the slide is a real one-shot.
const GLYPHS = "#%&@01<>/\\";
const DECODE_MS = 300;
const noise = (n) => [...Array(6)].map(() => [...Array(n)].map(() => GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join(""));
const line = (color, h = 2) => div().absolute().bottom(0).left(0).w_full().h(h).bg(color);

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export default class Tabs extends View {
  init(_props, cx) {
    this.acx = cx; // timers need the AsyncContext; render's cx dies with the call
    this.pressed = null;
    this.scroll = ScrollHandle.new();
    this.panels = JSON.parse(localStorage.getItem("panels.v2") ?? "{}");
    this.titles = new Map(); // tab id → last title seen
    this.decoding = new Map(); // tab id → { noise, gen, moved }
    this.gen = 0;
  }

  // A tab seen for the first time, or retitled, decodes once. Two one-shot timers flip state
  // (start the slide, then drop the cover); the motion itself is native.
  decode(id, text, anim) {
    if (this.titles.get(id) === text) return;
    this.titles.set(id, text);
    if (!anim) return this.decoding.delete(id);
    const d = { noise: noise(text.length), gen: ++this.gen, moved: false };
    this.decoding.set(id, d);
    this.acx.timer.after(30, cx => { d.moved = true; cx.notify(); });
    this.acx.timer.after(DECODE_MS + 80, cx => { if (this.decoding.get(id) === d) { this.decoding.delete(id); cx.notify(); } });
  }

  // The side panel is remembered per space: switching shows that space's choice
  // (Jobs if it never had one), and opening or closing it records it.
  syncPanel(space, panel, body, enabled) {
    if (!space || !panel) return;
    const now = panel.hidden ? null : body?.active ?? null;
    if (space.id !== this.space) {
      this.space = space.id; this.pending = null;
      const stored = space.id in this.panels ? this.panels[space.id] : "jobs", want = enabled.includes(stored) ? stored : null;
      if (want !== now) {
        this.pending = { want, until: Date.now() + 1000 };
        if (want) { run("layout.select", { stack: "panel-body", child: want }); run("layout.show", { id: "panel" }); }
        else run("layout.hide", { id: "panel" });
        return;
      }
    }
    // Until the restore lands (or something else won), the old state isn't a choice.
    if (this.pending) {
      if (this.pending.want !== now && Date.now() < this.pending.until) return;
      this.pending = null;
    }
    if (this.panels[space.id] === now) return;
    this.panels[space.id] = now;
    localStorage.setItem("panels.v2", JSON.stringify(this.panels));
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const active = shown.findIndex(tab => tab.active);
    const selected = shown[active]?.id;
    if (selected !== this.selected || active !== this.selectedIndex) {
      this.selected = selected;
      this.selectedIndex = active;
      if (active >= 0) this.scroll.scroll_to_item(active);
    }
    const anim = shared("cyberneon.animations") !== false;
    const stop = (_e, cx) => cx.stop_propagation();
    const button = (id, label, action) => div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(0).border(1).border_color(t.border).text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", stop).on_click(action).child(label);
    // The real text always lays out, so the tab keeps its final width; the cover only paints over it.
    const title = (c, text, bg) => {
      this.decode(c.id, text, anim);
      const d = anim && this.decoding.get(c.id);
      const w = Math.min(text.length * 8, 170) + 8; // ponytail: ~8px/char overshoot, overflow_hidden clips it
      const slide = (el, dir = 1) => el.transition("left", { duration: DECODE_MS, easing: "linear" }).left(d.moved ? dir * w : 0);
      return div().relative().max_w(170).truncate().child(text)
        .when(Boolean(d), el => el.child(slide(div().id(`dec-${c.id}-${d.gen}`).absolute().top(0).bottom(0).w(w).overflow_hidden().bg(bg))
          // Counter-slide so the glyphs stay put while the cover's edge sweeps right.
          .child(slide(div().id(`decn-${c.id}-${d.gen}`).absolute().top(0).whitespace_nowrap().frames(d.noise, 50), -1))));
    };
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      const sq = (color) => div().size(6).flex_none().bg(color);
      return h_flex().id(`tab-${c.id}`).relative().h(28).px(10).gap(7).rounded(0).items_center().flex_none().text_size(12)
        .font_family("Chakra Petch").font_weight(600)
        // A rename or status dot on this or an earlier tab can push the active one out.
        .when(i <= active, el => el.on_size_change((_size, cx) => { this.scroll.scroll_to_item(active); cx.notify(); }))
        .bg(c.active ? t.selected : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(c.active ? t.selected : t.hover))
        .child(cap(t.chrome)).child(edge(c.active ? t.accent : t.border))
        .when(c.active, el => el.child(line(t.done)))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "cyberneon-menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(title(c, c.zoomed ? `${name} Z` : name, c.active ? t.selected : t.chrome))
        // Working: ▰▱▱ bar when animated, a still cyan square when animations are off.
        .when(c.status === "working", el => el.child(anim
          ? div().flex_none().text_size(10).text_color(t.working).font_family("Share Tech Mono").frames(["▰▱▱", "▱▰▱", "▱▱▰"], 110)
          : sq(t.working)))
        .when(c.status === "blocked", el => el.child(anim ? sq(t.blocked).loop("opacity", { from: -6, to: 7, period: 900, easing: "linear" }) : sq(t.blocked)))
        .when(c.status === "done", el => el.child(sq(t.done)))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    const root = layout(), sidebar = find(root, "sidebar"), w = window();
    // Old saved rails and a dragged-narrow sidebar can be smaller than the window buttons.
    const lightsPadding = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && root?.traffic_lights
      ? Math.max(10, (root.traffic_lights[0] + 64) / settings().zoom - (sidebar?.hidden ? 0 : sidebar?.size?.px ?? 0))
      : 10;
    const panel = find(root, "panel"), body = find(root, "panel-body");
    // This layout always offers Jobs and Graph (cyberneon-jobs journal, cyberneon-graph in panel-body).
    const enabled = [...new Set([...(shared("workspace.panels") ?? ["files", "changes"]), "jobs", "graph"])];
    this.syncPanel(space, panel, body, enabled);
    const panelButton = (id, label, icon) => {
      const on = panel && !panel.hidden && body?.active === id;
      return div().id(`panel-${id}`).relative().size(26).flex_none().flex().items_center().justify_center().rounded(0)
        .border(1).border_color(on ? t.accent : t.border).text_color(on ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", stop).tooltip(label)
        .when(on, el => el.child(line(t.accent)))
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: id }); run("layout.show", { id: "panel" }); }
        }).child(svg(icon).size(14));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().track_scroll(this.scroll)
        .on_size_change((_size, cx) => { if (active >= 0) { this.scroll.scroll_to_item(active); cx.notify(); } })
        .children(shown.map(item)))
      .child(button("tab-new", "+", () => openOverlay({ mod: "cyberneon-new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(panelButton("jobs", "Jobs", "mods/cyberneon-tabs/jobs.svg"))
      .child(panelButton("graph", "Graph", "mods/cyberneon-tabs/graph.svg"))
      .when(w?.buttons, el => el.child(button("minimize", w.platform === "windows" ? svg("mods/cyberneon-tabs/win-min.svg").size(16) : "−", () => run("window.minimize")))
        .child(button("maximize", w.platform === "windows" ? svg(`mods/cyberneon-tabs/${w.maximized ? "win-restore" : "win-max"}.svg`).size(16) : "□", () => run("window.maximize")))
        .child(button("close-window", w.platform === "windows" ? svg("mods/cyberneon-tabs/win-close.svg").size(16) : svg("mods/pane/close.svg").size(13), () => run("window.close"))));
  }
}
