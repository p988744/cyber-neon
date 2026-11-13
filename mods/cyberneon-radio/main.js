import { View, div } from "gpui-kit";
import { theme } from "herdr";
import { RadioEngine } from "./engine.js";
import { localReceiver } from "./bridge.js";

// Playback foundation only. #8/#10 can use this.engine from their handlers.
// Put one copy in a layout-owned block (never a terminal pane) to bind its lifetime.
export default class Radio extends View {
  init(_props, cx) {
    this.engine = new RadioEngine(localReceiver());
    this.polling = false;
    cx.timer.every(5000, (cx) => {
      if (!this.engine.started || this.polling) return;
      this.polling = true;
      cx.spawn(async (cx) => {
        const before = JSON.stringify(this.engine.snapshot());
        await this.engine.poll();
        this.polling = false;
        if (before !== JSON.stringify(this.engine.snapshot())) cx.notify();
      });
    });
  }

  async close() { await this.engine.close(); }

  render() {
    const state = this.engine.snapshot();
    return div().font_family("Share Tech Mono").text_size(11).text_color(theme().muted)
      .child(state.error || state.title || `RADIO // ${state.status.toUpperCase()}`);
  }
}
