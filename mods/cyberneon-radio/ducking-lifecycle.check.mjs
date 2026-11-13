// Actual Tuner + RadioEngine, deterministic bridge failures, no host sampling
// between lifecycle actions. No process, network or user's app/config involved.
import assert from "node:assert/strict";
import { RadioEngine } from "./engine.js";
import { Tuner } from "./tuner.js";
import { Ducking, DUCK_MS } from "./ducking.js";
import { ReceiverGone } from "./receiver-client.js";
function fixture() {
  let now = 1000, starts = 0, fail = null;
  const wire = [], player = { volume: 50, mute: false, pause: false, "idle-active": true };
  const bridge = {
    available: async () => true, start: async () => { starts++; }, close: async () => {},
    request: async payload => {
      const commands = payload.trim().split("\n").map(s => JSON.parse(s));
      if (fail) { const error = fail; fail = null; throw error; }
      return commands.map(({command: c, request_id}) => {
        wire.push(c);
        if (c[0] === "loadfile") player["idle-active"] = false;
        if (c[0] === "stop") player["idle-active"] = true;
        if (c[0] === "set_property") player[c[1]] = c[2];
        return { request_id, error: "success", data: player[c[1]] };
      });
    },
  };
  const engine = new RadioEngine(bridge), duck = new Ducking(engine, true, () => now);
  const entries = [{ name: "One", url: "/one.wav" }, { name: "Two", url: "/two.wav" }, { name: "Browser", open: "https://example.invalid/" }];
  const opened = [], tuner = new Tuner(engine, { snapshot: () => ({ stations: entries }), prepare: async station => ({ station, source: station.url }) }, async url => opened.push(url));
  tuner.setVolumeControl(duck);
  const observe = status => duck.observe([{ address: "t1", status }], [], now);
  return { engine, duck, tuner, player, wire, entries, opened, observe,
    fail: error => { fail = error; }, starts: () => starts,
    now: () => now, advance: ms => { now += ms; } };
}
for (const ending of ["off", "poll-loss", "play-loss", "browser", "tune"]) {
  const f = fixture();
  await f.observe("working"); await f.tuner.volume(80); await f.tuner.mute(); await f.tuner.power();
  await f.observe("blocked"); assert.equal(f.player.volume, 16);
  await f.tuner.volume(65); assert.equal(f.player.volume, 13);
  const deadline = f.duck.until;
  if (ending === "off") { await f.tuner.power(); await f.tuner.power(); }
  if (ending === "poll-loss") {
    f.fail(new ReceiverGone("expired")); await f.engine.poll();
    assert.equal(f.duck.until, 0, "loss invalidates gain synchronously");
    assert.equal(f.starts(), 1, "loss never starts a receiver");
    await f.tuner.volume(75); // latest intent while receiver is absent
    await f.tuner.power();
  }
  if (ending === "play-loss") { f.fail(new ReceiverGone("expired on play")); await f.tuner.choose(f.entries[1]); }
  if (ending === "browser") {
    await f.tuner.choose(f.entries[2]); assert.equal(f.duck.until, 0);
    assert.equal(f.engine.snapshot().source, null); assert.equal(f.opened.length, 1);
    await f.tuner.choose(f.entries[0]); await f.tuner.power();
  }
  if (ending === "tune") await f.tuner.choose(f.entries[1]);
  assert.equal(f.player.volume, ending === "tune" ? 13 : ending === "poll-loss" ? 75 : 65, ending);
  assert.equal(f.player.mute, true, ending);
  assert.equal(f.duck.until, ending === "tune" ? deadline : 0, ending);
  // The first replay volume command, not merely the final corrective write,
  // must use current intent after stop/loss (including internal Play recovery).
  if (ending !== "tune") {
    assert.equal(f.engine.snapshot().volume, f.player.volume);
    const load = f.wire.findLastIndex(c => c[0] === "loadfile");
    const initialVolume = f.wire.slice(load).find(c => c[0] === "set_property" && c[1] === "volume");
    assert.equal(initialVolume[2], f.player.volume, "first replay write uses latest intent");
  }
  f.duck.close(); f.tuner.close(); await f.engine.close();
}
{
  const f = fixture(); await f.observe("working"); await f.tuner.power(); await f.observe("blocked");
  assert.equal(f.player.volume, 10);
  f.advance(DUCK_MS); f.fail(new Error("one restore timeout"));
  await f.duck.tick(f.now());
  assert.equal(f.player.volume, 10); assert.ok(f.engine.snapshot().error);
  await f.engine.poll(); assert.equal(f.engine.snapshot().error, null);
  assert.equal(f.player.volume, 10, "poll success alone does not restore gain");
  const wake = f.duck.nextWake(); assert.ok(wake > f.now());
  f.advance(wake - f.now()); await f.duck.tick(f.now());
  assert.equal(f.player.volume, 50, "failed restore remains pending after a successful poll");
  assert.equal(f.duck.nextWake(), 0); assert.equal(f.starts(), 1);
  f.duck.close(); await f.engine.close();
}
// Persistent failures use capped backoff, while a new intent/disable takes
// precedence and close invalidates all retries without creating a receiver.
{
  const f = fixture(); await f.observe("working"); await f.tuner.power(); await f.observe("blocked");
  f.advance(DUCK_MS);
  for (const delay of [250, 500, 1000, 2000, 2000]) {
    f.fail(new Error("transient IPC timeout")); await f.duck.tick(f.now());
    assert.equal(f.duck.nextWake() - f.now(), delay);
    const count = f.wire.length;
    await f.duck.tick(f.now()); assert.equal(f.wire.length, count, "no retry before backoff");
    f.advance(delay);
  }
  await f.tuner.volume(70); assert.equal(f.player.volume, 70);
  assert.equal(f.duck.nextWake(), 0);
  await f.observe("working"); await f.observe("blocked");
  f.fail(new Error("disable restore timeout")); await f.duck.setEnabled(false);
  assert.equal(f.duck.until, 0); assert.ok(f.duck.nextWake());
  await f.tuner.volume(90); assert.equal(f.player.volume, 90);
  assert.equal(f.duck.nextWake(), 0);
  await f.duck.setEnabled(true); await f.observe("working"); await f.observe("blocked");
  f.advance(DUCK_MS); f.fail(new Error("restore timeout before close")); await f.duck.tick(f.now());
  assert.ok(f.duck.nextWake()); const count = f.wire.length;
  f.duck.close(); f.tuner.close(); await f.engine.close();
  f.advance(5000); await f.duck.tick(f.now());
  assert.equal(f.duck.nextWake(), 0); assert.equal(f.wire.length, count); assert.equal(f.starts(), 1);
}
console.log("duck lifecycle checks passed (no-observation Off/recovery/browser/tune, intent/mute, failed restore + successful poll + retry)");
