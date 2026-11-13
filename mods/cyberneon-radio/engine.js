import { command, nowPlaying } from "./ipc.js";

export const NO_RECEIVER = "NO RECEIVER // install mpv";

// One instance per layout-owned Radio View. The injected bridge owns only local processes.
export class RadioEngine {
  constructor(bridge) {
    this.bridge = bridge;
    this.state = { status: "idle", source: null, title: "", paused: false, volume: 50, muted: false, error: null };
    this.tail = Promise.resolve();
    this.closed = false;
    this.started = false;
    this.attempted = false;
  }

  snapshot() { return { ...this.state }; }
  enqueue(work) {
    const job = this.tail.then(async () => {
      if (this.closed) return this.snapshot();
      try { await work(); }
      catch (error) {
        if (!this.closed) this.state = { ...this.state, status: "error", error: String(error.message ?? error) };
      }
      return this.snapshot();
    });
    this.tail = job.catch(() => {});
    return job;
  }

  play(source) {
    const load = command("play", source); // validate before starting anything
    return this.enqueue(async () => {
      if (!this.started) {
        if (!await this.bridge.available()) {
          this.state = { ...this.state, status: "unavailable", error: NO_RECEIVER };
          return;
        }
        if (this.closed) return;
        this.attempted = true; // close must bypass the queue, including a pending start
        await this.bridge.start();
        if (this.closed) return;
        this.started = true;
      }
      await this.bridge.request(load + command("pause", false, 2)
        + command("volume", this.state.volume, 3) + command("mute", this.state.muted, 4));
      if (!this.closed) this.state = { ...this.state, status: "loading", source, title: "", paused: false, error: null };
    });
  }

  control(action, value) {
    const message = command(action, value);
    return this.enqueue(async () => {
      if (!this.started) return; // controls never start mpv
      await this.bridge.request(message);
      if (this.closed) return;
      if (action === "stop") this.state = { ...this.state, status: "idle", source: null, title: "", paused: false, error: null };
      if (action === "pause") this.state = { ...this.state, paused: value,
        status: this.state.source ? (value ? "paused" : "playing") : "idle" };
      if (action === "mute") this.state = { ...this.state, muted: value };
      if (action === "volume") this.state = { ...this.state, volume: Math.max(0, Math.min(100, value)) };
    });
  }
  pause(value = true) { return this.control("pause", value); }
  stop() { return this.control("stop"); }
  volume(value) { return this.control("volume", value); }
  mute(value = true) { return this.control("mute", value); }

  // Owner calls every 5s, including while hidden: metadata refresh + guardian heartbeat.
  poll() {
    return this.enqueue(async () => {
      if (!this.started) return;
      const props = ["metadata", "media-title", "idle-active", "pause", "volume", "mute"];
      const replies = await this.bridge.request(props.map((p, i) => command("get", p, i + 1)).join(""), true);
      if (this.closed) return;
      const data = Object.fromEntries(replies.filter((r) => r.error === "success").map((r) => [props[r.request_id - 1], r.data]));
      const idle = data["idle-active"] === true;
      this.state = { ...this.state, status: idle ? "idle" : data.pause ? "paused" : "playing",
        title: idle ? "" : nowPlaying(data.metadata, data["media-title"]), source: idle ? null : this.state.source,
        paused: data.pause ?? this.state.paused, volume: data.volume ?? this.state.volume,
        muted: data.mute ?? this.state.muted, error: null };
    });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.state = { ...this.state, status: "closed", source: null, title: "" };
    // Start cleanup now, not after pending work: Herdr gives close only 250ms.
    if (this.attempted) await this.bridge.close();
  }
}
