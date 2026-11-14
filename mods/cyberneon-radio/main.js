import { View, div } from "gpui-kit";
import { h_flex, v_flex, Popover, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { theme, shared, nextCommand, agents, terminals } from "herdr";
import { RadioEngine } from "./engine.js";
import { localReceiver } from "./bridge.js";
import { localStations } from "./station-storage.js";
import { localBrowser } from "./browser-host.js";
import { Ducking } from "./ducking.js";
import { Tuner, staticFrames } from "./tuner.js";
import { DirectoryPanel } from "./search-ui.js";

const anim = () => shared("cyberneon.animations") !== false;
const STATIC = staticFrames();

// Exactly one layout-owned block; dismissing the popover never closes or
// duplicates the receiver. All handlers and panel content belong to this View.
export default class Radio extends View {
  init(_props, cx) {
    this.engine = new RadioEngine(localReceiver());
    this.store = localStations();
    this.directory = new DirectoryPanel(this.store);
    this.tuner = new Tuner(this.engine, this.store, localBrowser());

    this.ducking = new Ducking(this.engine, localStorage.getItem("ducking") !== "off");
    this.tuner.setVolumeControl(this.ducking);
    this.duckWake = 0;
    this.duckTimerGeneration = 0;
    this.open = false;
    this.tuning = 0;
    this.tuneGeneration = 0;
    this.warningGeneration = 0;
    this.dismissalGeneration = 0;
    this.warning = null;
    this.warningReady = null;
    this.polling = false;
    this.refreshing = false;
    this.volume = SliderState.new({ min: 0, max: 100, step: 1, value: 50 });
    this.volume.on("change", (_value, cx) => cx.notify());
    this.volume.on("release", (value, cx) => this.act("volume", cx, value));
    this.refresh(cx);
    cx.timer.every(2000, cx => this.refresh(cx));
    cx.timer.every(5000, (cx) => {
      if (!this.engine.started || this.polling) return;
      this.polling = true;
      cx.spawn(async (cx) => {
        try { await this.engine.poll(); }
        finally { this.polling = false; }
        cx.notify();
      });
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        this.command(command, cx);
      }
    });
  }

  armDucking(cx) {
    const at = this.ducking.nextWake();
    if (at === this.duckWake) return;
    this.duckWake = at;
    const generation = ++this.duckTimerGeneration;
    if (!at || this.tuner.closed) return;
    cx.timer.after(Math.max(0, at - Date.now()), cx => {
      if (this.tuner.closed || generation !== this.duckTimerGeneration) return;
      this.duckWake = 0;
      cx.spawn(async cx => {
        await this.ducking.tick();
        this.armDucking(cx);
        cx.notify();
      });
    });
  }

  command(command, cx) {
    if (!["next", "prev", "mute"].includes(command)) return;
    // Keyboard browsing has the same visible selection/warning as pointer use.
    if (command !== "mute") this.open = true;
    this.act(command, cx);
  }

  setOpen(open, cx) {
    this.open = open;
    if (!open) {
      this.dismissalGeneration++;
      this.finishWarning(false);
    }
    cx.notify();
  }

  finishWarning(shown) {
    const ready = this.warningReady;
    this.warningReady = null;
    if (ready) ready(shown);
  }

  async presentWarning(station, cx, dismissalGeneration) {
    // This action's generation was captured before prepare. Dismissal while
    // resolving a source must cancel ordinary loads as well as warning waits.
    if (dismissalGeneration !== this.dismissalGeneration || this.tuner.closed) return false;
    if (!station.explicit) return;
    this.open = true;
    this.warning = { station, generation: ++this.warningGeneration };
    const shown = new Promise(resolve => { this.warningReady = resolve; });
    cx.notify();
    // The warning's native size callback runs after its first layout. A microtask
    // or fixed sleep alone cannot ensure the panel was presented before Play.
    const visible = await shown;
    this.warning = null;
    return visible && dismissalGeneration === this.dismissalGeneration && !this.tuner.closed;
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      const before = JSON.stringify(this.store.snapshot());
      try {
        const refresh = this.store.refresh();
        // Use this task's live context; never retain cx in a store subscriber.
        cx.notify();
        await refresh;
      } finally { this.refreshing = false; }
      if (before !== JSON.stringify(this.store.snapshot())) cx.notify();
    });
  }

  act(action, cx, value) {
    const dismissalGeneration = this.dismissalGeneration;
    const visual = (action === "power" && !this.tuner.on() && !this.tuner.browserOpened && this.tuner.station())
      || (["next", "prev", "choose"].includes(action) && this.tuner.on() && this.tuner.stations().length);
    if (visual && anim()) {
      const generation = ++this.tuneGeneration;
      this.tuning = generation;
      cx.timer.after(420, cx => { if (this.tuning === generation) { this.tuning = 0; cx.notify(); } });
    }
    cx.spawn(async (cx) => {
      const beforePlay = async station => {
        if (await this.presentWarning(station, cx, dismissalGeneration) === false) return false;
        return () => dismissalGeneration === this.dismissalGeneration && !this.tuner.closed;
      };
      const job = action === "next" ? this.tuner.step(1, beforePlay) : action === "prev" ? this.tuner.step(-1, beforePlay)
        : action === "choose" ? this.tuner.choose(value, beforePlay)
        : action === "power" ? this.tuner.power(beforePlay)
        : action === "volume" ? this.tuner.volume(value) : this.tuner[action]();
      await job;
      cx.notify();
    });
    cx.notify();
  }

  async close() {
    this.dismissalGeneration++;
    this.tuner.close();
    this.ducking?.close();
    this.finishWarning(false);
    // Start receiver cleanup directly, bypassing pending prepare/controls.
    const closing = this.engine.close();
    this.directory.close();
    await closing;
    this.volume.release();
  }

  button(id, label, action, enabled = true) {
    const t = theme();
    return div().id(id).h(26).px(9).flex().items_center().justify_center().flex_none()
      .border_1().border_color(t.border).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover).border_color(t.accent)))
      .on_click((_e, cx) => { if (enabled) action(cx); }).child(label);
  }

  panel() {
    const t = theme(), state = this.engine.snapshot(), list = this.store.snapshot();
    const station = this.tuner.station(), on = this.tuner.on(), busy = this.tuner.pending > 0;
    const playing = on ? this.tuner.playing : null;
    const browser = this.tuner.browserOpened;
    const warning = this.warning?.station ?? (station?.explicit ? station : playing?.explicit ? playing : browser?.explicit ? browser : null);
    const warningGeneration = this.warning?.generation;
    const title = on ? state.title || "WAITING FOR TRACK DATA" : "RECEIVER OFF";
    const moving = anim() && on && title.length > 34;
    const error = this.tuner.error || (!browser && state.error) || list.error;
    const line = div().id("radio-now-playing").relative().h(22).overflow_hidden().text_color(t.working)
      .tooltip(title).child(div().relative().flex_none().whitespace_nowrap().child(title)
        .when(moving, el => el.loop("left", { from: 0, to: -Math.max(20, title.length * 7 - 242), period: Math.max(5000, title.length * 160), easing: "linear" })));
    return v_flex().w(320).p(12).gap(9).bg(t.popover).border_1().border_color(t.accent)
      .font_family("Share Tech Mono").text_size(11).text_color(t.muted)
      .child(h_flex().items_center().justify_between()
        .child(div().font_family("Chakra Petch").font_weight(700).text_color(t.accent).child("RADIO // SIGNAL DECK"))
        .child(this.button("radio-close", "×", cx => this.setOpen(false, cx))))
      .child(div().text_size(18).text_color(t.foreground).truncate().child(station?.name || (list.loading ? "LOADING STATIONS" : "NO STATIONS")))
      .when(Boolean(playing) && (!station || this.tuner.key(playing) !== this.tuner.key(station)), el => el.child(div().text_color(t.working).child(`ON AIR // ${playing.name}`)))
      .when(Boolean(station?.genre), el => el.child(div().child(station.genre)))
      .when(Boolean(warning), el => el.child(div().text_color(t.done)
        .when(Boolean(this.warning), row => row.id(`radio-warning-${this.warning.generation}`)
          .on_size_change((_size, _cx) => { if (this.warning?.generation === warningGeneration) this.finishWarning(true); }))
        .child(`Explicit content${this.warning ? ` // ${warning.name}` : ""}${warning.contentWarning && warning.contentWarning !== "Explicit content" ? ` // ${warning.contentWarning}` : ""}`)))
      .when(Boolean(station?.note), el => el.child(div().child(station.note)))
      .child(line)
      .when(Boolean(station?.open), el => el.child(div().text_color(t.dim).child("BROWSER ONLY // opens outside Herdr")))
      .when(Boolean(browser), el => el.child(div().id("radio-browser-opened").text_color(t.muted)
        .child(`OPENED IN BROWSER // ${browser.name}. Playback is managed in your browser.`)))
      .child(div().id("radio-dial").h(18).overflow_hidden().text_color(t.accent).child("┆ · ┆ · ┃ · ┆ · ┆ · ┃ · ┆ · ┆ · ┃")
        .when(Boolean(this.tuning) && anim(), el => el.frames(STATIC, 55)))
      .child(h_flex().gap(6).items_center()
        .child(this.button("radio-prev", "◀ PREV", cx => this.act("prev", cx), Boolean(station) && !busy))
        .child(this.button("radio-next", "NEXT ▶", cx => this.act("next", cx), Boolean(station) && !busy))
        .child(div().flex_1())
        .child(this.button("radio-power", on ? "OFF" : browser ? "CLEAR" : station?.open ? "OPEN" : "PLAY", cx => this.act("power", cx), (on || Boolean(browser) || Boolean(station)) && !busy)))
      .child(h_flex().gap(8).items_center()
        .child(this.button("radio-mute", this.tuner.silenced ? "UNMUTE" : "MUTE", cx => this.act("mute", cx), !busy))
        .child(Slider.new(this.volume).flex_1().child(SliderTrack.new(this.volume).h(26).w_full().flex().items_center()
          .child(SliderIndicator.new(this.volume).relative().w_full().h(4).bg(t.border)
            .range_style(fill => fill.bg(t.working))
            .child(SliderThumb.new(this.volume).size(10).ml(-5).bg(t.accent)))))
        .child(div().w(28).text_color(t.foreground).child(`${Math.round(this.volume.value())}`)))
      .child(h_flex().gap(8).items_center()
        .child(this.button("radio-ducking", this.ducking?.enabled ? "DUCK ON" : "DUCK OFF", cx => {
          const enabled = !this.ducking.enabled;
          localStorage.setItem("ducking", enabled ? "on" : "off");
          cx.spawn(async cx => { await this.ducking.setEnabled(enabled); cx.notify(); });
          cx.notify();
        }))
        .child(div().text_size(10).text_color(t.dim).child("AGENT NEEDS YOU // 4s · 20%")))
      .child(div().text_size(10).text_color(t.dim).child(busy ? "TUNING…" : `${on ? state.status.toUpperCase() : "OFF"} // ${list.stations.length} STATIONS`))
      .when(Boolean(error), el => el.child(div().text_color(t.blocked).child(String(error))))
      .when(!station && !list.loading, el => el.child(div().child(`Add your stations to ${list.path || "the radio station file"}. No stations or music are bundled.`)))
      .when(Boolean(list.loading) && Boolean(station), el => el.child(div().text_color(t.dim).child("REFRESHING STATIONS…")))
      .when(Boolean(station), el => el.child(v_flex().id("radio-stations").max_h(100).overflow_y_scrollbar().gap(2)
        .children(list.stations.map((s, i) => h_flex().id(`radio-station-row-${i}`).items_center().gap(2)
          .bg(this.tuner.key(s) === this.tuner.key(station) ? t.selected : t.popover)
          .child(div().id(`radio-station-${i}`).flex_1().min_w(0).truncate().px(6).py(4).cursor_pointer()
            .hover(el => el.bg(t.hover)).on_click((_e, cx) => this.act("choose", cx, s))
            .child(`${s.name}${s.explicit ? " // Explicit content" : ""}`))
          .child(div().id(`radio-remove-${i}`).px(6).py(4).flex_none().cursor_pointer().text_color(t.dim)
            .tooltip(`Remove ${s.name}`).hover(el => el.bg(t.hover).text_color(t.blocked))
            .on_click((_e, cx) => this.act("remove", cx, s)).child("×"))))))
      .child(div().text_size(10).text_color(t.dim).child("PLAY to power on. Select/next/prev tune while on."))
      .child(this.directory.render(t));
  }

  render(cx) {
    // Herdr rerenders for live agents/terminals, including while the tuner is
    // dismissed. Read those snapshots reactively; timers only service gain work.
    if (cx && this.ducking && !this.tuner.closed) {
      const work = this.ducking.observe(agents(), terminals());
      if (work) cx.spawn(async cx => { await work; this.armDucking(cx); cx.notify(); });
      else if (this.ducking.nextWake() !== this.duckWake) cx.spawn(async cx => this.armDucking(cx));
    }
    const t = theme(), state = this.engine.snapshot();
    const name = this.tuner.on() ? this.tuner.playing?.name || "ON" : "OFF";
    const browser = this.tuner.browserOpened;
    const explicit = (this.tuner.on() && this.tuner.playing?.explicit) || browser?.explicit;
    const chip = h_flex().id("radio-chip").h(20).w(180).px(7).gap(5).items_center().border_1()
      .border_color(this.tuner.on() ? t.working : t.border).text_color(this.tuner.on() ? t.working : t.muted)
      .font_family("Share Tech Mono").text_size(11).cursor_pointer().hover(el => el.bg(t.hover))
      .tooltip(`${this.tuner.error || (!browser && state.error) ? `${this.tuner.error || state.error} // ` : ""}Radio // ${name}${browser ? ` // Opened in browser: ${browser.name}` : ""}${explicit ? " // Explicit content" : ""}`)
      .child(div().flex_none().child("RADIO"))
      .child(div().flex_1().min_w(0).truncate().child(name))
      .when(Boolean(explicit), el => el.child(div().id("radio-explicit").flex_none().text_size(9).text_color(t.done)
        .tooltip("Explicit content").child("EXPLICIT")));
    return h_flex().size_full().px(8).items_center().bg(t.chrome).border_t(1).border_color(t.border)
      .child(Popover.new("radio-tuner").anchor("bottom_right").open(this.open)
        .on_open_change((open, cx) => this.setOpen(open, cx))
        .trigger(chip).content(this.panel()));
  }
}
