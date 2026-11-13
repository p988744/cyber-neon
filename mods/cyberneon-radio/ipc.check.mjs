// node mods/cyberneon-radio/ipc.check.mjs
import assert from "node:assert/strict";
import { command, nowPlaying, parseReplies } from "./ipc.js";
import { RadioEngine, NO_RECEIVER } from "./engine.js";

const source = 'https://example.invalid/a?title="hello"&x=$(echo nope)';
assert.deepEqual(JSON.parse(command("play", source, 9)), { command: ["loadfile", source, "replace"], request_id: 9 });
assert.deepEqual(JSON.parse(command("play", "/tmp/a file's \\ music.flac")).command, ["loadfile", "/tmp/a file's \\ music.flac", "replace"]);
for (const [action, value, args] of [
  ["pause", true, ["set_property", "pause", true]], ["pause", false, ["set_property", "pause", false]],
  ["stop", undefined, ["stop"]], ["volume", -1, ["set_property", "volume", 0]],
  ["volume", 101, ["set_property", "volume", 100]], ["mute", true, ["set_property", "mute", true]],
  ["mute", false, ["set_property", "mute", false]], ["get", "metadata", ["get_property", "metadata"]],
]) {
  const wire = command(action, value);
  assert.ok(wire.endsWith("\n"));
  assert.equal(wire.trim().split("\n").length, 1);
  assert.deepEqual(JSON.parse(wire).command, args);
}
for (const value of ["", "  ", "a\nb", "a\0b", null]) assert.throws(() => command("play", value));
for (const value of [NaN, Infinity, "50"]) assert.throws(() => command("volume", value));
assert.throws(() => command("pause", "yes"));
assert.throws(() => command("run", "sh"));
assert.equal(nowPlaying({ "icy-title": " Artist — Song " }, "Station"), "Artist — Song");
assert.equal(nowPlaying({ "ICY-TITLE": "曲目" }, "Station"), "曲目");
for (const value of [null, {}, [], { "icy-title": " " }, { "icy-title": 99 }]) assert.equal(nowPlaying(value, " File title "), "File title");
assert.equal(nowPlaying(null, null), "");
assert.deepEqual(parseReplies('{"event":"file-loaded"}\n{"request_id":1,"error":"success"}\n'), [{ request_id: 1, error: "success" }]);
assert.throws(() => parseReplies("not json\n"));

// The engine serializes concurrent plays, reuses one receiver, and does no work
// beyond probing if mpv is missing. Controls before play never start a receiver.
function fixture(available = true) {
  const calls = [];
  return { calls, available: async () => { calls.push("probe"); return available; },
    start: async () => { calls.push("start"); }, close: async () => { calls.push("close"); },
    request: async (wire) => { calls.push(...parseReplies(wire).map((m) => m.command)); return []; } };
}
{
  const bridge = fixture(false), engine = new RadioEngine(bridge);
  await engine.pause(); await engine.volume(20); await engine.stop(); await engine.poll();
  assert.deepEqual(bridge.calls, []);
  await engine.play(source);
  assert.equal(engine.snapshot().error, NO_RECEIVER);
  await engine.mute(); await engine.close();
  assert.deepEqual(bridge.calls, ["probe"]);
}
{
  const bridge = fixture(), engine = new RadioEngine(bridge);
  await Promise.all([engine.play("/tmp/first"), engine.play("/tmp/second")]);
  assert.equal(bridge.calls.filter((c) => c === "start").length, 1);
  await engine.pause(); await engine.mute(); await engine.volume(42);
  assert.equal(engine.snapshot().volume, 42);
  await engine.stop();
  assert.equal(engine.snapshot().title, "");
  assert.equal(engine.snapshot().source, null);
  await engine.close(); await engine.close(); await engine.play(source);
  assert.equal(bridge.calls.filter((c) => c === "close").length, 1);
  assert.equal(engine.snapshot().status, "closed");
}
{
  const bridge = fixture(), engine = new RadioEngine(bridge);
  let release, entered;
  const pending = new Promise((resolve) => { release = resolve; });
  const starting = new Promise((resolve) => { entered = resolve; });
  bridge.start = async () => { entered(); await pending; };
  const play = engine.play(source);
  await starting;
  await engine.close(); // must finish without waiting for start
  release(); await play;
  assert.deepEqual(bridge.calls, ["probe", "close"]);
  assert.equal(engine.snapshot().status, "closed");
}
{
  const bridge = fixture(), engine = new RadioEngine(bridge);
  await engine.play(source);
  bridge.request = async () => [
    { request_id: 1, error: "success", data: { "icy-title": "Live song" } },
    { request_id: 2, error: "success", data: "Station" },
    { request_id: 3, error: "success", data: false },
    { request_id: 4, error: "success", data: true },
  ];
  await engine.poll();
  assert.equal(engine.snapshot().title, "Live song");
  assert.equal(engine.snapshot().status, "paused");
  bridge.request = async () => [{ request_id: 3, error: "success", data: true }];
  await engine.poll();
  assert.equal(engine.snapshot().title, "");
  assert.equal(engine.snapshot().status, "idle");
  await engine.close();
}
console.log("ipc.check ok (protocol, metadata, lifecycle, missing mpv)");
