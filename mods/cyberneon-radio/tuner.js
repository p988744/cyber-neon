// UI state only: the station store resolves sources; the engine owns playback.
export class Tuner {
  constructor(engine, store) {
    this.engine = engine;
    this.store = store;
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
  key(s) { return JSON.stringify([s.name, s.url ?? s.open]); }
  select(station) { this.selected = this.key(station); this.error = null; }
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
  async play(station) {
    if (!station || this.closed) return;
    const prepared = await this.store.prepare(station);
    // Closing during playlist resolution must not start a receiver.
    if (this.closed) return;
    await this.engine.play(prepared.source);
    const state = this.engine.snapshot();
    const requested = Array.isArray(prepared.source) ? prepared.source[0] : prepared.source;
    if (!this.closed && state.status === "loading" && state.source === requested) {
      this.playing = prepared.station;
      await this.engine.volume(this.level);
      await this.engine.mute(this.silenced);
    }
  }
  power() {
    return this.enqueue(async () => {
      if (this.on()) await this.engine.stop();
      else await this.play(this.station());
    });
  }
  step(direction) {
    return this.enqueue(async () => {
      const list = this.stations();
      if (!list.length) return;
      const selected = this.station();
      const index = list.findIndex(s => this.key(s) === this.key(selected));
      const station = list[(index + direction + list.length) % list.length];
      this.select(station);
      // Off means browse only. A list reload is never a playback command.
      if (this.on()) await this.play(station);
    });
  }
  choose(station) {
    return this.enqueue(async () => {
      this.select(station);
      if (this.on()) await this.play(station);
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
      if (this.engine.started) await this.engine.volume(this.level);
    });
  }
  close() { this.closed = true; }
}

// Deterministically generated visual interference, never an audio asset.
export function staticFrames() {
  return Array.from({ length: 7 }, (_, f) => Array.from({ length: 36 }, (_, i) =>
    ["░", "▒", "·", "│"][(i * 13 + f * 7 + (i ^ f)) % 4]).join(""));
}
