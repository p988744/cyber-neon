import { command, nowPlaying } from "./ipc.js";
import { ReceiverGone } from "./receiver-client.js";

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
  async request(payload, allowUnavailable = false) {
    try { return await this.bridge.request(payload, allowUnavailable); }
    catch (error) {
      if (error instanceof ReceiverGone && !this.closed) {
        this.started = false;
        this.state = { ...this.state, source: null, title: "", paused: false };
      }
      throw error;
    }
  }
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
    // Copy and validate the complete queue before starting anything. mpv advances
    // naturally; each explicit play replaces the old queue, without repeat/shuffle.
    const sources = Array.isArray(source) ? [...source] : [source];
    if (!sources.length || sources.length > 1000) throw new Error("Expected 1..1000 radio sources");
    const load = sources.map((item, i) => command(i ? "append" : "play", item, i + 1)).join("");
    return this.enqueue(async () => {
      // Only an explicit Play may recover. Also handle expiry not yet seen by
      // poll, on this same click, with at most one replacement attempt.
      for (let attempt = 0; attempt < 2; attempt++) {
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
        try {
          await this.request(load + command("pause", false, sources.length + 1)
            + command("volume", this.state.volume, sources.length + 2) + command("mute", this.state.muted, sources.length + 3));
        } catch (error) {
          if (error instanceof ReceiverGone && attempt === 0 && !this.closed) continue;
          throw error;
        }
        if (!this.closed) this.state = { ...this.state, status: "loading", source: sources[0], title: "", paused: false, error: null };
        return;
      }
    });
  }

  control(action, value) {
    const message = command(action, value);
    return this.enqueue(async () => {
      if (!this.started) return; // controls never start mpv
      await this.request(message);
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
      const replies = await this.request(props.map((p, i) => command("get", p, i + 1)).join(""), true);
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
