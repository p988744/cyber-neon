import { View, div, svg, PathBuilder, Background } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, props, window, shared, setShared, updates, layout, machines } from "herdr";

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

// The sidebar's rail goes by its width, not a flag: dragging its edge narrows it too.
const narrow = () => (find(layout(), "sidebar")?.size?.px ?? Infinity) < 160;

// To the rail (on macOS wide enough for the traffic lights), or back to the width it had.
function toggleSidebar() {
  const width = find(layout(), "sidebar")?.size?.px;
  if (!narrow()) setShared("sidebar.width", width);
  // Mods edited before the rail went by width still read the flag.
  setShared("sidebar.collapsed", !narrow());
  run("layout.resize", { id: "sidebar", px: narrow() ? (shared("sidebar.width") ?? 268) : window()?.platform === "macos" ? 76 : 44 });
}

// Undefined counts as on; every cyberneon mod reads this key.
const animOn = () => shared("cyberneon.animations") !== false;
const toggleAnim = () => setShared("cyberneon.animations", !animOn());

const D = "mods/cyberneon-chrome";
// Glitch flick: a linear opacity swing far below 0 clamps to "off" except ~100ms around each peak, once per 3s round trip.
const flick = el => el.loop("opacity", { from: -40, to: 1.5, period: 3000, easing: "linear" });

const WORD = "CYBER//NEON";
// Typing: the real word lays out underneath; a chrome cover with a ▌ on its left edge slides right off it.
// ponytail: .frames runs on one shared clock (unknown phase), so a padded frames list can't start at frame 0; .transition is a real one-shot.
const TYPE_MS = 480;
const COVER = 130; // ponytail: overshoots the ~105px word; the wordmark's overflow_hidden clips the rest
// Module code runs once per source version, so the brand types once per app start (and once per mod reload).
let typed = false;
// Barcode: [bar, gap] px widths, ~40px. ponytail: fixed pattern, it's decoration.
const BARS = [[1, 1], [2, 1], [1, 2], [3, 1], [1, 1], [1, 2], [2, 1], [1, 1], [3, 2], [1, 1], [2, 1], [1, 2], [1, 1], [2, 0]];
const RECT = () => PathBuilder.fill().move_to("0%", "0%").line_to("100%", "0%").line_to("100%", "100%").line_to("0%", "100%").close().build();
const layer = bg => globalThis.window.paint_path(RECT(), bg).absolute().top(0).left(0).size_full();

export default class WorkspaceChrome extends View {
  init(_p, cx) {
    if (props()?.footer || typed || !animOn()) return; // init's first arg lacks the layout props; props() has them
    typed = this.typing = true;
    cx.timer.after(30, cx => { this.moved = true; cx.notify(); });
    cx.timer.after(TYPE_MS + 80, cx => { this.typing = false; cx.notify(); });
  }
  button(id, label, action) {
    const t = theme();
    return div().id(id).size(26).flex_none().flex().items_center().justify_center().rounded(0).border_1().border_color(t.border)
      .text_color(t.muted).hover(s => s.bg(t.hover).border_color(t.accent).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(action).child(label);
  }
  wordmark() {
    const t = theme();
    const word = c => div().font_family("Rajdhani").font_bold().text_size(19).text_color(c).child(WORD);
    if (this.typing && animOn()) return div().relative().flex_none().overflow_hidden().child(word(t.accent))
      .child(div().id("type-cover").absolute().top(0).bottom(0).w(COVER).bg(t.chrome)
        .transition("left", { duration: TYPE_MS, easing: "linear" }).left(this.moved ? COVER : 0)
        .child(div().absolute().top(0).left(0).font_family("Rajdhani").font_bold().text_size(19).text_color(t.accent).child("▌")));
    // ponytail: copies sit behind the solid accent word, so only their ±2px edges show when they flick in.
    return div().relative().flex_none()
      .when(animOn(), el => el
        .child(flick(word(t.working).absolute().top(0).left(-2)))
        .child(flick(word(t.blocked).absolute().top(0).left(2))))
      .child(word(t.accent).relative());
  }
  render() {
    const t = theme();
    const collapsed = narrow();
    if (props()?.footer) {
      const box = icon => div().size(18).flex_none().flex().items_center().justify_center().rounded(0).border_1().border_color(t.border)
        .child(svg(`${D}/${icon}.svg`).size(12));
      const row = (id, icon, label, dim, action) => h_flex().id(id).h(24).px(6).gap(8).items_center().rounded(0)
        .when(collapsed, el => el.relative().w(32).px(0).justify_center().tooltip(label))
        .text_color(dim ? t.dim : t.muted).hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
        .on_click(action).child(box(icon))
        .when(!collapsed, el => el.child(label.toUpperCase()));
      const ready = div().size(6).rounded(0).bg(t.accent);
      const on = animOn();
      const anim = h_flex().id("anim").h(18).px(6).gap(5).items_center().flex_none().rounded(0).border_1()
        .border_color(on ? t.accent : t.border).text_color(on ? t.accent : t.dim).text_size(10.5).font_family("Share Tech Mono")
        .hover(s => s.bg(t.hover)).cursor_pointer().tooltip("Toggle cyberneon animations")
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(toggleAnim)
        .child(div().size(6).rounded(0).when(on, el => el.bg(t.accent)).when(!on, el => el.border_1().border_color(t.dim)))
        .child(on ? "ANIM ON" : "ANIM OFF");
      return v_flex().size_full().bg(t.chrome).border_t(1).border_color(t.border).px(8).pt(5).pb(5).gap(2)
        .font_family("Chakra Petch").font_weight(600).text_size(12)
        .when(collapsed, el => el.px(0).items_center())
        .child(h_flex().items_center().gap(6)
          .child(row("settings", "settings", "Settings", false, () => run("app.settings")).when(!collapsed, el => el.flex_1())
            .when(Boolean(updates().app.ready), el => el.child(collapsed ? ready.absolute().top(4).right(4) : ready)))
          // ponytail: the 60px footer only fits two rail icons, so the switch shows on the wide sidebar only.
          .when(!collapsed, el => el.child(anim)))
        .child(row("machine", "plus", "Add machine", true, () => run("mod.open", { name: "machine-add" })));
    }
    // Brand: word + v0.1 + barcode over a 9px data line; a 4px yellow hazard band along the bottom edge.
    return h_flex().relative().size_full().bg(t.chrome).pl(collapsed ? 6 : 14).pr(10).pb(4).gap(4).items_center()
      .when(window()?.platform === "macos" && !window()?.fullscreen && !collapsed, el => el.pl(76))
      .when(!collapsed, el => el.child(v_flex().flex_1().min_w(0).overflow_hidden()
        .child(h_flex().gap(6).items_end()
          .child(this.wordmark())
          .child(div().flex_none().font_family("Share Tech Mono").text_size(10).pb(3).text_color(t.dim).child("v0.1"))
          .child(h_flex().flex_none().h(10).mb(4).children(BARS.map(([b, g]) => div().w(b).mr(g).h_full().bg(t.dim)))))
        .child(div().font_family("Share Tech Mono").text_size(9).text_color(t.dim).opacity(0.7).truncate()
          .child(`SYS//0x7F3A  NODE//${machines().length}`))))
      .when(!collapsed, el => el.child(this.button("search", svg(`${D}/search.svg`).size(14), () => run("mod.open", { name: "picker" }))))
      // On the macOS rail the traffic lights fill the row; the agents list's » unfolds it.
      .when(!(collapsed && window()?.platform === "macos"), el => el.child(this.button("sidebar-toggle", svg(`${D}/sidebar.svg`).size(14), toggleSidebar)))
      .child(div().absolute().left(0).right(0).bottom(0).h(4)
        .child(layer(t.solid)).child(layer(Background.pattern_slash("#0a0b0f59", 2, 6))));
  }
}
