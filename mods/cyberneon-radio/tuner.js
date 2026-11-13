import { stationMetadata } from "./stations.js";
import { browserURL } from "./browser.js";

// UI state only: the station store resolves sources; the engine owns playback.
export class Tuner {
  constructor(engine, store, openBrowser = null) {
    this.engine = engine;
    this.store = store;
    this.openBrowser = openBrowser;
    this.browserOpened = null;
    this.volumeControl = engine;
    this.selected = null;
    this.playing = null;
    this.error = null;
    this.pending = 0;
    this.tail = Promise.resolve();
    this.closed = false;
    this.level = 50;
    this.silenced = false;
  }
  stations() { return this.store.snapshot().stations; }
  station() {
    const list = this.stations();
    return list.find(s => this.key(s) === this.selected) ?? list[0] ?? null;
  }
  key(s) { return JSON.stringify([s.name, s.open ? "browser" : "receiver", s.open ?? s.url]); }
  select(station) { this.selected = this.key(station); this.browserOpened = null; this.error = null; }
  on() { return Boolean(this.engine.snapshot().source); }
  enqueue(work) {
    this.pending++;
    const job = this.tail.then(async () => {
      if (this.closed) return;
      this.error = null;
      try { await work(); }
      catch (error) { if (!this.closed) this.error = String(error.message ?? error); }
    }).finally(() => { this.pending--; });
    this.tail = job.catch(() => {});
    return job;
  }
  async play(station, beforePlay) {
    if (!station || this.closed) return;
    if (station.open !== undefined) {
      const browser = stationMetadata(station);
      const url = browserURL(browser.open);
      if (!this.openBrowser) throw new Error("Browser-only station: browser opener unavailable");
      // Preserve the View's action-generation cancellation and explicit warning
      // gate before either stopping local audio or opening an external page.
      const actionValid = beforePlay ? await beforePlay(browser) : undefined;
      if (actionValid === false || (typeof actionValid === "function" && !actionValid())) return;
      if (this.closed) return;
      this.browserOpened = null;
      if (this.on()) {
        await this.engine.stop();
        if (this.closed) return;
        const state = this.engine.snapshot();
        if (state.source || state.error) throw new Error(state.error || "Cannot stop local radio before browser handoff");
      }
      this.playing = null;
      // Stop may yield long enough for the View to dismiss this action. The
      // optional hook returns a synchronous validity check after warning layout.
      if (this.closed || (typeof actionValid === "function" && !actionValid())) return;
      await this.openBrowser(url);
      if (!this.closed) this.browserOpened = browser;
      return;
    }
    const prepared = await this.store.prepare(station);
    if (this.closed) return;
    // The View can present normalized station metadata before loading audio.
    const actionValid = beforePlay ? await beforePlay(prepared.station) : undefined;
    if (actionValid === false || (typeof actionValid === "function" && !actionValid())) return;
    // Closing during playlist resolution must not start a receiver.
    if (this.closed) return;
    this.browserOpened = null;
    await this.engine.play(prepared.source);
    const state = this.engine.snapshot();
    const requested = Array.isArray(prepared.source) ? prepared.source[0] : prepared.source;
    if (!this.closed && state.status === "loading" && state.source === requested) {
      this.playing = prepared.station;
      await this.volumeControl.volume(this.level);
      await this.engine.mute(this.silenced);
    }
  }
  power(beforePlay) {
    return this.enqueue(async () => {
      if (this.on()) { this.browserOpened = null; await this.engine.stop(); }
      else if (this.browserOpened) this.browserOpened = null;
      else await this.play(this.station(), beforePlay);
    });
  }
  step(direction, beforePlay) {
    return this.enqueue(async () => {
      const list = this.stations();
      if (!list.length) return;
      const selected = this.station();
      const index = list.findIndex(s => this.key(s) === this.key(selected));
      const station = list[(index + direction + list.length) % list.length];
      this.select(station);
      // Off means browse only. A list reload is never a playback command.
      if (this.on()) await this.play(station, beforePlay);
    });
  }
  choose(station, beforePlay) {
    return this.enqueue(async () => {
      this.select(station);
      if (this.on()) await this.play(station, beforePlay);
    });
  }
  mute() {
    return this.enqueue(async () => {
      this.silenced = !this.silenced;
      if (this.engine.started) await this.engine.mute(this.silenced);
    });
  }
  volume(value) {
    return this.enqueue(async () => {
      this.level = Math.max(0, Math.min(100, value));
      if (this.engine.started || this.volumeControl !== this.engine) await this.volumeControl.volume(this.level);
    });
  }
  setVolumeControl(control) { this.volumeControl = control; }
  close() { this.closed = true; this.browserOpened = null; }
}

// Deterministically generated visual interference, never an audio asset.
export function staticFrames() {
  return Array.from({ length: 7 }, (_, f) => Array.from({ length: 36 }, (_, i) =>
    ["░", "▒", "·", "│"][(i * 13 + f * 7 + (i ^ f)) % 4]).join(""));
}
