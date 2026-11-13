// Temporary gain only. Never owns playback, mute, receiver recovery or host timers.
export const DUCK_MS = 4000;
export const DUCK_FACTOR = 0.2;

export class Ducking {
  constructor(engine, enabled = true) {
    this.engine = engine;
    this.enabled = enabled;
    this.level = 50;
    this.until = 0;
    this.seen = new Map();
    this.baselined = false;
    this.closed = false;
    this.tail = Promise.resolve();
  }
  // Both pane agents and background children use host addresses/statuses. Raw
  // terminals win over presentation status (which can turn done into idle).
  observe(agents, terminals, now) {
    if (this.closed) return this.tail;
    const list = new Map(agents.map(a => [a.address, a.status]));
    for (const t of terminals) if (t.state === "live") list.set(t.address, t.status);
    let blocked = false;
    for (const [address, status] of list) {
      if (this.baselined && status === "blocked" && this.seen.get(address) !== "blocked") blocked = true;
      this.seen.set(address, status);
    }
    // init can expose no agents; wait for the first populated host snapshot.
    if (list.size) this.baselined = true;
    const before = Boolean(this.until);
    if (this.until && (now >= this.until || !this.engine.started || !this.engine.snapshot().source)) this.until = 0;
    if (blocked && this.enabled && this.engine.started && this.engine.snapshot().source) this.until = now + DUCK_MS;
    return before !== Boolean(this.until) ? this.apply() : this.tail;
  }
  volume(value) {
    this.level = Math.max(0, Math.min(100, value));
    return this.apply();
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.until = 0;
    return this.apply();
  }
  apply() {
    // Resolve gain at execution time: an older queued restore must never undo
    // a newer event, slider change, disable, or close.
    const job = this.tail.then(async () => {
      if (this.closed || !this.engine.started) return;
      await this.engine.volume(this.level * (this.until ? DUCK_FACTOR : 1));
    });
    this.tail = job.catch(() => {});
    return job;
  }
  close() { this.closed = true; this.until = 0; this.seen.clear(); }
}
