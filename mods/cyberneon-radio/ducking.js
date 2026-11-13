// Temporary gain only. Never starts/resumes playback or owns receiver recovery.
export const DUCK_MS = 4000;
export const DUCK_FACTOR = 0.2;
const RETRY_MIN = 250, RETRY_MAX = 2000;

export class Ducking {
  constructor(engine, enabled = true, clock = () => Date.now()) {
    this.engine = engine;
    this.enabled = enabled;
    this.clock = clock;
    this.level = 50;
    this.until = 0;
    this.seen = new Map();
    this.baselined = false;
    this.closed = false;
    this.applying = 0;
    this.dirty = false;
    this.retryAt = 0;
    this.retryDelay = RETRY_MIN;
    this.tail = Promise.resolve();
    engine.setVolumePolicy?.({ value: () => this.target(), reset: () => this.reset() });
  }
  target() { return this.level * (this.until ? DUCK_FACTOR : 1); }
  reset() {
    // Called synchronously by the engine on acknowledged stop, receiver loss or
    // EOF, before an explicit replay/replacement builds its volume command.
    this.until = 0;
    this.dirty = false;
    this.retryAt = 0;
    this.retryDelay = RETRY_MIN;
  }
  changed() { this.dirty = true; this.retryAt = 0; this.retryDelay = RETRY_MIN; }
  // Called on reactive host renders, never by a live-data polling timer.
  observe(agents, terminals, now = this.clock()) {
    if (this.closed) return null;
    const list = new Map(agents.map(a => [a.address, a.status]));
    for (const t of terminals) if (t.state === "live") list.set(t.address, t.status);
    let blocked = false;
    for (const [address, status] of list) {
      if (this.baselined && status === "blocked" && this.seen.get(address) !== "blocked") blocked = true;
      this.seen.set(address, status);
    }
    if (list.size) this.baselined = true;
    if (blocked && this.enabled && this.engine.started && this.engine.snapshot().source) {
      this.until = now + DUCK_MS;
      this.changed();
    }
    return this.tick(now);
  }
  tick(now = this.clock()) {
    if (this.closed) return null;
    if (this.until && (now >= this.until || !this.engine.started || !this.engine.snapshot().source)) {
      this.until = 0;
      this.changed();
    }
    return this.dirty && !this.applying && now >= this.retryAt ? this.apply() : null;
  }
  nextWake() {
    if (this.closed) return 0;
    const times = [this.until, this.dirty ? this.retryAt : 0].filter(Boolean);
    return times.length ? Math.min(...times) : 0;
  }
  volume(value) {
    this.level = Math.max(0, Math.min(100, value));
    this.changed();
    return this.apply();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.until = 0;
    this.changed();
    return this.apply();
  }
  apply() {
    this.applying++;
    const job = this.tail.then(async () => {
      if (this.closed) return;
      if (!this.engine.started) { this.reset(); return; }
      let state;
      try { state = await this.engine.volume(this.target()); }
      catch { /* Same retry path for throwing adapters and error snapshots. */ }
      if (this.closed) return;
      if (!this.engine.started) { this.reset(); return; }
      state ??= this.engine.snapshot();
      // An error snapshot resolves normally in RadioEngine. A later successful
      // poll can clear its error without applying our target: retain dirty work.
      if (!state.error && Math.abs(state.volume - this.target()) < 0.001) {
        this.dirty = false; this.retryAt = 0; this.retryDelay = RETRY_MIN;
      } else {
        this.dirty = true;
        this.retryAt = this.clock() + this.retryDelay;
        this.retryDelay = Math.min(RETRY_MAX, this.retryDelay * 2);
      }
    });
    const settled = job.finally(() => { this.applying--; });
    this.tail = settled.catch(() => {});
    return settled;
  }
  close() {
    this.closed = true; this.reset(); this.seen.clear();
    this.engine.setVolumePolicy?.(null);
  }
}
