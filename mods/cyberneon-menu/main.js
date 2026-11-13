// Context menus (Herdr's items). Opened as a popup with
// props { tab: "pane" | "tab" | "space" | "global", target }.
// ↑/↓ move, Enter runs, Esc closes. An item is [label, command, args];
// a command "worktree" opens the worktree dialog instead.

import { View, div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, keys, terminals, spaces, panes, exec, shared } from "herdr";

// Cyberneon frame (mod.json overlay frame: "none"), same technique as cyberneon-picker.
const W = globalThis.window;
const anim = () => shared("cyberneon.animations") !== false;
const CUT = 10;
const cutPath = (c) => PathBuilder.fill().add_polygon([[c, 0], ["100%", 0], ["100%", "100%"], [0, "100%"], [0, c]], true).build();
const MONO = "Share Tech Mono";
const danger = (it) => it[1].endsWith(".close") || it[2]?.action === "remove";
// A new group starts where the shipped menu drew its separator.
const breaks = (list, i) => i > 0 && (list[i][1].endsWith(".close") || list[i][1] === "app.help" || (list[i][1] === "app.theme" && list[i - 1][1] !== "app.theme"));
const groupTitle = (it, scope) => it[1].endsWith(".close") ? "TERMINATE" : it[1] === "app.help" ? "SYSTEM" : it[1] === "app.theme" ? "THEME" : (scope ?? "global").toUpperCase();

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}

// A space's checkout: "main" (a repo's own), "linked" (a worktree), or null.
async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function items(p, git) {
  p = p ?? {};
  const tg = p.target ?? {};
  switch (p.tab) {
    case "pane": {
      // A kept sub-agent can go back under its parent, still running.
      const all = terminals();
      const term = all.find((t) => t.address === tg.terminal);
      const parent = term?.parent && all.find((t) => t.address === term.parent);
      // Once they go to the program, Shift+right-click still opens this menu.
      const toProgram = term?.labels?.["herdr.right-click"] === "program";
      // A terminal shown outside a tab (a layout terminal block, a window) has
      // no pane to split, zoom or close: its pane is the block's id.
      const inTab = panes().some((pane) => pane.pane === tg.pane);
      return [
        ...(inTab
          ? [
              ["Split right", "pane.split", { direction: "right", pane: tg.pane }],
              ["Split down", "pane.split", { direction: "down", pane: tg.pane }],
              ["Zoom", "pane.zoom", { pane: tg.pane }],
            ]
          : []),
        ...(term
          ? [
              toProgram
                ? ["Use Herdr right-click menu", "terminal.right_click", { terminal: term.address, to: "menu" }]
                : ["Send right-clicks to pane", "terminal.right_click", { terminal: term.address, to: "program" }],
            ]
          : []),
        ...(parent ? [[`Send back to ${parent.name || parent.address}`, "terminal.park", { terminal: term.address }]] : []),
        ...(inTab ? [["Close pane", "pane.close", { pane: tg.pane }]] : []),
      ];
    }
    case "tab":
      return [
        ["Rename", "tab.rename", { id: tg.id }],
        ["New tab", "tab.new", { space: tg.space }],
        ["Close", "tab.close", { id: tg.id }],
      ];
    case "space":
      return [
        ["Rename", "space.rename", { id: tg.id }],
        ...(git ? [["New worktree", "worktree", { space: tg.id, action: "new" }], ["Open worktree", "worktree", { space: tg.id, action: "open" }]] : []),
        ...(git === "linked" ? [["Remove worktree", "worktree", { space: tg.id, action: "remove" }]] : []),
        ["Close", "space.close", { id: tg.id }],
      ];
    default:
      return [
        ["New space", "space.new", {}],
        ["Keybinds", "app.help", {}],
        ["Theme: graphite", "app.theme", { name: "graphite" }],
        ["Theme: ink", "app.theme", { name: "ink" }],
        ["Theme: moss", "app.theme", { name: "moss" }],
        ["Theme: atom one dark", "app.theme", { name: "atom-one-dark" }],
      ];
  }
}

function menuIcon(command) {
  const name = command.endsWith(".close") ? "x" : command.endsWith(".rename") ? "square-pen" : command.endsWith(".new") ? "plus" : command === "worktree" ? "git-branch" : command === "app.help" ? "terminal" : command === "app.theme" ? "settings" : command === "pane.split" ? "panel-right" : command === "pane.zoom" ? "square" : "terminal";
  return `mods/workspace-chrome/${name}.svg`;
}

// The key bound to a command, for the hint on the right.
function shortcut(name, args) {
  // `pane.split:right` binds pane.split with { direction: "right" }.
  const value = args && Object.values(args)[0];
  const k = keys().find((b) => b.section === "global" && (b.action === name || b.action === `${name}:${value}`));
  return k ? k.keys : "";
}

export default class Menu extends View {
  init(_props, cx) {
    this.at = 0;
    this.git = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const p = props();
    const space = p?.tab === "space" && spaces().find((s) => s.id === p.target?.id);
    const folder = space && place(space);
    // 120ms fade-in: first frame at 0, the native transition carries it to 1.
    this.shown = !anim();
    if (!this.shown) cx.timer.after(16, () => { this.shown = true; cx.notify(); });
    if (folder)
      cx.spawn(async (cx) => {
        this.git = await checkout(folder, space.machine).catch(() => null);
        cx.notify();
      });
  }

  choose(i, cx) {
    const it = items(props(), this.git)[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    if (it[1] === "worktree") openOverlay({ mod: "worktree", kind: "dialog", ...(it[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }), props: it[2] });
    else run(it[1], it[2]);
  }

  render(cx) {
    const t = theme();
    const list = items(props(), this.git);
    let n = 0;
    const title = (it) => h_flex().h(18).px(8).gap(6).items_center().flex_none()
      .child(div().font_family(MONO).text_size(9).text_color(t.dim).child(`//${String(++n).padStart(2, "0")}`))
      .child(div().font_family("Chakra Petch").font_semibold().text_size(9).text_color(t.dim).child(groupTitle(it, props()?.tab)));
    const rule = () => div().relative().mx(4).my(4).h(1).flex_none().bg(t.border)
      .child(div().absolute().top(0).left(0).w(24).h(1).bg(t.accent));
    const bracket = () => div().absolute().size(8).border_color(t.accent);
    return v_flex()
      .id("menu")
      .track_focus(this.handle)
      .relative()
      .w_full()
      .min_h(0)
      .p(6)
      .text_size(13)
      .opacity(this.shown ? 1 : 0)
      .when(anim(), (el) => el.transition("opacity", { duration: 120 }))
      .child(W.paint_path(cutPath(CUT), t.accent).absolute().top(0).left(0).size_full())
      .child(W.paint_path(cutPath(CUT - 1), t.popover).absolute().top(1).left(1).right(1).bottom(1))
      .child(bracket().bottom(3).right(3).border_b(1).border_r(1))
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at, cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(
        list.map((it, i) => {
          const on = i === this.at;
          return v_flex()
            .when(breaks(list, i), (el) => el.child(rule()))
            .when(i === 0 || breaks(list, i), (el) => el.child(title(it)))
            .child(h_flex()
              .id(`mi-${i}`)
              .h(26)
              .px(6)
              .gap(7)
              .rounded(0)
              .border_1()
              .border_color(on ? t.working : "#00000000")
              .items_center()
              .justify_between()
              .font_semibold()
              .text_color(danger(it) ? t.blocked : t.foreground)
              .when(on, (el) => el.bg(t.working + "26"))
              .on_hover((h, cx) => { if (h && this.at !== i) { this.at = i; cx.notify(); } })
              .on_click((_e, cx) => this.choose(i, cx))
              .child(div().w(8).flex_none().text_size(10).text_color(t.working).child(on ? "▸" : ""))
              .child(svg(menuIcon(it[1])).size(13).flex_none().text_color(danger(it) ? t.blocked : on ? t.working : t.muted))
              .child(div().flex_1().truncate().child(it[0]))
              .child(div().flex_none().font_family(MONO).text_size(10).text_color(t.dim).child(shortcut(it[1], it[2]))));
        }),
      );
  }
}
