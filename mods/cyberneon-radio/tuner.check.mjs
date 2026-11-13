import assert from "node:assert/strict";
import { Tuner, staticFrames } from "./tuner.js";

const stations = [
  { name: "Test Alpha", url: "https://example.invalid/a", explicit: false },
  { name: "Test Beta", url: "/test/folder", explicit: true, contentWarning: "Explicit content" },
];
let list = [], prepared = [], reject = false, gate;
const store = {
  snapshot: () => ({ stations: list.map(s => ({ ...s })) }),
  prepare: async station => {
    prepared.push(station);
    if (gate) await gate;
    if (reject) throw new Error("Browser-only station");
    return { station, source: station.name === stations[1].name ? ["/test/a.wav", "/test/b.wav"] : station.url };
  },
};
function engine() {
  return {
    state: { status: "idle", source: null, muted: false, volume: 50 }, started: false, calls: [],
    snapshot() { return { ...this.state }; },
    async play(source) { this.calls.push(["play", source]); this.started = true; this.state.status = "loading"; this.state.source = Array.isArray(source) ? source[0] : source; },
    async stop() { this.calls.push(["stop"]); this.state.source = null; },
    async mute(value) { this.calls.push(["mute", value]); this.state.muted = value; },
    async volume(value) { this.calls.push(["volume", value]); this.state.volume = value; },
  };
}
const e = engine(), t = new Tuner(e, store);
assert.equal(t.station(), null);
await t.power(); await t.step(1);
assert.deepEqual(e.calls, []);
list = stations;
assert.deepEqual(t.station(), stations[0]);
assert.deepEqual(prepared, []); // config arrival never plays
await t.step(-1);
assert.deepEqual(t.station(), stations[1]);
assert.deepEqual(e.calls, []); // browsing while off never prepares
await t.volume(23); await t.mute();
assert.deepEqual(e.calls, []); // preferences before first play don't start mpv
await t.power();
assert.deepEqual(e.calls, [["play", ["/test/a.wav", "/test/b.wav"]], ["volume", 23], ["mute", true]]);
assert.deepEqual(t.playing, stations[1]);
await t.step(1);
assert.deepEqual(t.playing, stations[0]); // wrapping + tune while on
await t.choose(stations[1]);
assert.deepEqual(t.playing, stations[1]);
list = [stations[0]];
assert.deepEqual(t.station(), stations[0]);
assert.deepEqual(t.playing, stations[1]); // reload doesn't relabel the playing source
assert.equal(prepared.length, 3);
reject = true;
await t.choose(stations[0]);
assert.equal(t.error, "Browser-only station");
assert.deepEqual(t.playing, stations[1]); // failed resolution preserves actual chip
await t.power();
assert.equal(t.on(), false);
reject = false;
await Promise.all([t.power(), t.power()]);
assert.equal(t.on(), false); // rapid controls serialized
assert.equal(t.pending, 0);

// A rejected load can leave the old source alive in the engine. Don't relabel
// its chip as the requested station just because source is still non-null.
await t.power();
const playing = t.playing;
const originalPlay = e.play;
e.play = async () => { e.state.status = "error"; e.state.error = "load rejected"; };
list = stations;
await t.choose(stations[1]);
assert.equal(t.playing, playing);
e.play = originalPlay;

// Death/EOF never auto-resumes; the next explicit play calls prepare again.
e.state.source = null; e.started = false;
const before = prepared.length;
await t.power();
assert.equal(prepared.length, before + 1);

// Closing while prepare waits must not load anything or revive an owner.
const other = engine(), closing = new Tuner(other, store);
let release;
gate = new Promise(resolve => { release = resolve; });
const pending = closing.power();
await Promise.resolve();
closing.close(); release(); await pending;
assert.deepEqual(other.calls, []);
gate = null;
await closing.power();
assert.deepEqual(other.calls, []);
assert.equal(staticFrames().length, 7);
assert.equal(new Set(staticFrames()).size > 1, true);
console.log("tuner state checks passed");
