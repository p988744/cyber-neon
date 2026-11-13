import assert from "node:assert/strict";
import { Ducking, DUCK_MS } from "./ducking.js";
import { Tuner } from "./tuner.js";
const state = { source: "/silent.wav", volume: 50, muted: false, status: "playing" };
const levels = [], plays = [];
const engine = {
  started: true, snapshot: () => ({ ...state }),
  async volume(v) { levels.push(v); state.volume = v; },
  async mute(v) { state.muted = v; },
  async play(source) { plays.push(source); this.started = true; Object.assign(state, { source, status: "loading" }); },
};
const station = { name: "Fixture", url: "/silent.wav" };
const store = { snapshot: () => ({ stations: [station] }), prepare: async s => ({ station: s, source: s.url }) };
const duck = new Ducking(engine), tuner = new Tuner(engine, store);
tuner.setVolumeControl(duck);
let now = 1000;
const host = status => [{ address: "remote/t1", status, state: "live" }];
const observe = status => duck.observe([], host(status), now);
await duck.observe([], [], now);
await observe("blocked"); assert.deepEqual(levels, [], "first populated snapshot is a baseline");
await observe("working"); await observe("blocked");
assert.equal(state.volume, 10); assert.equal(tuner.level, 50);
const firstUntil = duck.until;
now += 500; await observe("blocked"); assert.equal(duck.until, firstUntil);
await tuner.volume(80); assert.equal(state.volume, 16); assert.equal(tuner.level, 80);
await tuner.mute(); assert.equal(state.muted, true);
now += 1000;
await duck.observe([], [...host("blocked"), { address: "t2", status: "blocked", state: "live" }], now);
assert.equal(state.volume, 16, "overlap does not multiply gain");
assert.equal(duck.until, now + DUCK_MS);
now = firstUntil;
await duck.observe([], [...host("blocked"), { address: "t2", status: "blocked", state: "live" }], now);
assert.equal(state.volume, 16, "old deadline cannot restore newer duck");
now += DUCK_MS;
await observe("blocked"); assert.equal(state.volume, 80); assert.equal(state.muted, true);
await tuner.mute(); assert.equal(state.muted, false);
await observe("working"); await observe("blocked");
await duck.setEnabled(false); assert.equal(state.volume, 80); assert.equal(duck.until, 0);
await observe("working"); await observe("blocked"); assert.equal(state.volume, 80);
await duck.setEnabled(true); await observe("blocked"); assert.equal(duck.until, 0, "enable never replays an old blocked snapshot");
await observe("working"); await observe("blocked");
await tuner.volume(0); assert.equal(state.volume, 0);
await tuner.volume(35); assert.equal(state.volume, 7);
engine.started = false; state.source = null;
now += 250; await observe("blocked"); assert.equal(duck.until, 0); assert.equal(duck.level, 35);
assert.deepEqual(plays, [], "loss, events and expiry never start playback");
await tuner.power(); assert.equal(state.volume, 35, "explicit receiver recovery restores intended volume");
await observe("working"); await observe("blocked");
state.source = null; await observe("blocked"); assert.equal(state.volume, 35, "power off clears temporary gain");
await observe("working"); await observe("blocked"); assert.equal(duck.until, 0, "off receiver cannot duck or play");
// A queued gain computes current intent; stale work cannot override disable or
// manual changes. Closing invalidates queued callbacks before engine teardown.
state.source = station.url;
await observe("working");
const work = observe("blocked"); const disable = duck.setEnabled(false); const manual = tuner.volume(67);
await Promise.all([work, disable, manual]); assert.equal(state.volume, 67);
await duck.setEnabled(true); await observe("working");
const before = levels.length;
const pending = observe("blocked"); duck.close(); await pending;
await duck.volume(99); await observe("working");
assert.equal(levels.length, before); assert.equal(duck.until, 0);
console.log("ducking host edges, intent/mute, overlap, expiry, disable, recovery and close checks passed");
