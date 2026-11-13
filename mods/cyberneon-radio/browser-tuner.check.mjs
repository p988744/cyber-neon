import assert from "node:assert/strict";
import { Tuner } from "./tuner.js";
import { StationStore } from "./stations.js";

const clean = { name: "Local fixture", url: "/fixture.wav" };
const web = { name: "Browser fixture", open: "https://example.invalid/playlist", explicit: true };
function fixture() {
  const calls = [], opened = [], prepared = [];
  const engine = {
    state: { status: "idle", source: null, error: null }, started: false,
    snapshot() { return { ...this.state }; },
    async play(source) { calls.push(["play", source]); this.started = true; Object.assign(this.state, { status: "loading", source, error: null }); },
    async stop() { calls.push(["stop"]); Object.assign(this.state, { status: "idle", source: null, error: null }); },
    async volume(value) { calls.push(["volume", value]); }, async mute(value) { calls.push(["mute", value]); },
  };
  const store = new StationStore({ path: "/fixture/radio.json", read: async () => "[]", resolve: async url => { prepared.push(url); return url; } });
  store.state.stations = [clean, web];
  const tuner = new Tuner(engine, store, async url => { calls.push(["browser", url]); opened.push(url); });
  return { engine, tuner, store, calls, opened, prepared };
}
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };

// Off browsing and config refresh never launch anything. A power request needs
// no receiver installation; browser-only sources never reach store.prepare.
{
  const f = fixture();
  await f.tuner.choose(web); await f.tuner.step(-1); await f.tuner.choose(web);
  assert.deepEqual(f.calls, []);
  await f.tuner.power(station => { assert.equal(station.contentWarning, "Explicit content"); return true; });
  assert.deepEqual(f.calls, [["browser", web.open]]);
  assert.deepEqual(f.prepared, []);
  assert.equal(f.tuner.on(), false); assert.equal(f.engine.started, false);
  assert.equal(f.tuner.playing, null); assert.equal(f.tuner.browserOpened.name, web.name);
  await f.tuner.power(); // clear the handoff notice, without controlling a browser
  assert.equal(f.tuner.browserOpened, null); assert.equal(f.opened.length, 1);
}

// Warning layout precedes stop; one serialized handoff leaves preferences and
// receiver ownership alone. Both-field entries use open, with no url fallback.
{
  const f = fixture(); await f.tuner.power();
  const before = f.calls.length, warning = deferred();
  const action = f.tuner.choose({ ...web, url: "/must-not-play.wav" }, async s => {
    assert.equal(s.contentWarning, "Explicit content"); return warning.promise;
  });
  await flush(); assert.equal(f.calls.length, before);
  warning.resolve(true); await action;
  assert.deepEqual(f.calls.slice(before), [["stop"], ["browser", web.open]]);
  assert.deepEqual(f.prepared, [clean.url]);
  assert.equal(f.tuner.on(), false); assert.equal(f.tuner.playing, null);
  // Same display name and url must not alias two different actions.
  assert.notEqual(f.tuner.key({ ...web, url: clean.url }), f.tuner.key({ name: web.name, url: clean.url }));
  await f.tuner.choose(clean); await f.tuner.power();
  assert.equal(f.tuner.browserOpened, null); assert.equal(f.tuner.playing.name, clean.name);
  assert.equal(f.engine.started, true);
}

for (const ending of ["cancel", "close"]) {
  const f = fixture(); await f.tuner.power(); const before = f.calls.length;
  const warning = deferred();
  const action = f.tuner.choose(web, () => warning.promise);
  await flush();
  if (ending === "close") f.tuner.close();
  warning.resolve(ending !== "cancel"); await action;
  assert.equal(f.calls.length, before, "cancelled/closed warning must not stop audio or open browser");
  assert.equal(f.tuner.browserOpened, null);
}

// Closing while stop is pending prevents browser launch; closing during opener
// completion cannot revive the handoff state. No lifecycle cleanup is delegated.
for (const phase of ["stop", "open"]) {
  const f = fixture(); await f.tuner.power(); const gate = deferred();
  if (phase === "stop") f.engine.stop = async () => { await gate.promise; f.engine.state.source = null; };
  else f.tuner.openBrowser = async () => { await gate.promise; };
  const action = f.tuner.choose(web); await flush(); f.tuner.close(); gate.resolve(); await action;
  assert.deepEqual(f.opened, []); assert.equal(f.tuner.browserOpened, null);
}

// A failed stop must not layer browser audio over an active receiver, including
// an engine command failure expressed as a snapshot rather than a thrown error.
for (const thrown of [false, true]) {
  const f = fixture(); await f.tuner.power();
  f.engine.stop = async () => { if (thrown) throw new Error("stop failed"); f.engine.state.error = "stop failed"; };
  await f.tuner.choose(web);
  assert.equal(f.tuner.error, "stop failed"); assert.deepEqual(f.opened, []);
  assert.equal(f.tuner.playing.name, clean.name); assert.equal(f.tuner.on(), true);
}
{
  const f = fixture(); await f.tuner.power();
  f.tuner.openBrowser = async () => { throw new Error("browser unavailable"); };
  await f.tuner.choose(web);
  assert.equal(f.tuner.error, "browser unavailable"); assert.equal(f.tuner.on(), false);
  assert.equal(f.tuner.browserOpened, null); assert.equal(f.tuner.playing, null);
  assert.deepEqual(f.prepared, [clean.url], "opener failure must not fall back to mpv");
  await f.tuner.choose(clean); await f.tuner.power();
  assert.equal(f.tuner.error, null); assert.equal(f.tuner.playing.name, clean.name);
}
{
  const f = fixture(); await f.tuner.power(); const before = f.calls.length;
  for (const open of ["javascript:alert(1)", "https://", "file:///tmp/no"]) {
    await f.tuner.choose({ ...web, open });
    assert.ok(f.tuner.error); assert.equal(f.calls.length, before, "invalid URLs must not stop local audio");
  }
  await assert.rejects(f.store.prepare(web), /Browser-only/);
  await f.tuner.choose(clean); const gate = deferred();
  f.tuner.openBrowser = async url => { await gate.promise; f.opened.push(url); };
  const handoff = f.tuner.choose(web), power = f.tuner.power();
  await flush(); assert.equal(f.tuner.pending, 2); gate.resolve();
  await Promise.all([handoff, power]);
  assert.deepEqual(f.opened, [web.open]); assert.equal(f.tuner.browserOpened, null);
  assert.equal(f.tuner.pending, 0);
}
console.log("browser-tuner.check ok (warning/cancellation, stop/open failures, off browsing, serialization, close, no fallback)");
