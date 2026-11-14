import { div } from "gpui-kit";
import { h_flex, v_flex, Input, InputState } from "gpui-base";
import { RadioSearch, SEARCH_TAGS } from "./search.js";
import { localDirectory } from "./search-client.js";

const MONO = "Share Tech Mono";

// Created once in Radio.init with Radio's existing store. Owns no receiver.
export class DirectoryPanel {
  constructor(store, directory = localDirectory()) {
    this.store = store;
    this.model = new RadioSearch(directory, store);
    this.expanded = false;
    this.closed = false;
    this.waits = new Set();
    this.input = InputState.new({ placeholder: "Search by tag…" });
    this.input.on("submit", (_event, cx) => this.search(this.input.value(), cx));
  }
  search(tag, cx) {
    if (this.closed) return;
    this.input.set_value(tag);
    cx.spawn(async cx => {
      if (this.closed) return;
      const pending = this.model.search(tag);
      cx.notify();
      await pending;
      if (!this.closed) cx.notify();
    });
  }
  add(station, cx) {
    if (this.closed) return;
    cx.spawn(async cx => {
      if (this.closed) return;
      const pending = this.model.add(station, promise => this.wait(promise, cx));
      cx.notify();
      await pending;
      if (!this.closed) cx.notify();
    });
  }
  wait(promise, cx) {
    // Host exec has its own 5s timeout. This one-shot owner deadline also covers
    // a host promise that never settles. No polling or retained event context.
    return new Promise((resolve, reject) => {
      const finish = (error, value) => {
        if (!this.waits.delete(cancel)) return;
        timer.cancel();
        if (error) reject(error); else resolve(value);
      };
      const cancel = () => finish(new Error("Radio panel closed"));
      const timer = cx.timer.after(6000, () => finish(new Error("Saving radio station timed out; retry Add")));
      this.waits.add(cancel);
      Promise.resolve(promise).then(value => finish(null, value), error => finish(error));
    });
  }
  close() {
    this.closed = true;
    this.model.close();
    for (const cancel of this.waits) cancel();
    this.input.release();
  }
  button(id, label, t, action, enabled = true) {
    return div().id(id).px(6).h(24).flex().items_center().flex_shrink_0()
      .border(1).border_color(t.border).text_color(enabled ? t.working : t.dim)
      .when(enabled, el => el.cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => action(cx)))
      .child(label);
  }
  render(t) {
    const state = this.model.snapshot();
    const saved = this.store.snapshot().stations;
    const root = v_flex().id("radio-directory").gap(5).min_w(0).flex_shrink_0().font_family(MONO).text_size(10.5)
      .child(this.button("radio-directory-toggle", this.expanded ? "− RADIO BROWSER" : "+ FIND A STATION", t, cx => {
        this.expanded = !this.expanded;
        if (this.expanded) this.input.focus();
        cx.notify();
      }));
    if (!this.expanded) return root;
    return root
      .child(div().text_color(t.muted).child("Directory only · each station’s terms apply."))
      .child(h_flex().gap(4).min_w(0)
        .child(div().flex_1().min_w(0).h(26).border(1).border_color(t.border)
          .child(Input.new(this.input).size_full().font_family(MONO).text_size(11).text_color(t.foreground)))
        .child(this.button("radio-search-submit", state.loading ? "SEARCH…" : "SEARCH", t, cx => this.search(this.input.value(), cx), !state.loading)))
      .child(h_flex().gap(4).children(SEARCH_TAGS.map(tag => this.button(`radio-tag-${tag}`, tag, t, cx => this.search(tag, cx), !state.loading))))
      .when(!!state.error, el => el.child(div().text_color(t.blocked).child(state.error)))
      .when(!!state.message, el => el.child(div().text_color(t.done).child(state.message)))
      .when(state.loading, el => el.child(div().text_color(t.muted).child("Searching Radio Browser…")))
      .when(!state.loading && !!state.tag && !state.error && !state.results.length, el => el.child(div().text_color(t.muted).child("No stations found · try another tag.")))
      .when(state.results.length > 0, el => el.child(v_flex().id("radio-search-results").max_h(190).overflow_y_scrollbar().gap(4)
        .children(state.results.map((station, index) => {
          const exists = saved.some(s => (s.open || s.url) === station.url || (station.radioBrowserId && s.radioBrowserId === station.radioBrowserId));
          return v_flex().id(`radio-result-${index}`).min_w(0).gap(2).p(5).border(1).border_color(t.border)
            .child(h_flex().min_w(0).gap(6).items_center()
              .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(station.name))
              .child(this.button(`radio-add-${index}`, exists ? "SAVED" : state.saving === station.url ? "SAVING…" : "ADD", t, cx => this.add(station, cx), !exists && !state.saving)))
            .child(div().truncate().text_color(t.muted).child(`${station.country} · ${station.codec} / ${station.bitrate || "?"} kbps`))
            .child(div().truncate().text_color(station.lastCheckOK === null ? t.muted : station.lastCheckOK ? t.done : t.blocked)
              .child(`CHECK ${station.lastCheckOK === null ? "UNKNOWN" : station.lastCheckOK ? "OK" : "FAILED"} · ${station.lastCheck}`));
        }))));
  }
}
