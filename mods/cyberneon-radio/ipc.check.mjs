// node mods/cyberneon-radio/ipc.check.mjs
import assert from "node:assert/strict";
import { command, nowPlaying, parseReplies } from "./ipc.js";
import { RadioEngine, NO_RECEIVER } from "./engine.js";
import { receiverClient, ReceiverGone } from "./receiver-client.js";

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
// Receiver loss clears liveness, but never resumes automatically. Ordinary
// command/transport errors retain the healthy generation.
for (const detectedByPoll of [true, false]) {
  const bridge = fixture(), engine = new RadioEngine(bridge);
  await engine.play(source);
  const request = bridge.request;
  bridge.request = async () => { throw new ReceiverGone("expired"); };
  if (detectedByPoll) {
    await engine.poll();
    assert.equal(engine.started, false);
    assert.equal(engine.snapshot().source, null);
    await engine.poll(); await engine.pause();
    assert.equal(bridge.calls.filter((c) => c === "start").length, 1);
    bridge.request = request;
  } else {
    bridge.request = async (...args) => { bridge.request = request; throw new ReceiverGone("expired"); };
  }
  await engine.play(source);
  assert.equal(engine.snapshot().status, "loading");
  assert.equal(bridge.calls.filter((c) => c === "start").length, 2);
  bridge.request = async () => { throw new Error("command failed"); };
  await engine.pause();
  assert.equal(engine.started, true);
  bridge.request = request;
  await engine.play(source);
  assert.equal(bridge.calls.filter((c) => c === "start").length, 2);
  await engine.close();
}

// Arrays are copied and completely validated before any receiver is started.
{
  const bridge = fixture(), engine = new RadioEngine(bridge);
  for (const sources of [[], ["/tmp/ok.wav", "bad\npath"], Array(1001).fill("/tmp/a.wav")]) {
    assert.throws(() => engine.play(sources));
  }
  assert.deepEqual(bridge.calls, []);
  const sources = ["/tmp/a.wav", "/tmp/b.wav"];
  const pending = engine.play(sources);
  sources[1] = "/tmp/mutated.wav";
  await pending;
  assert.deepEqual(bridge.calls.filter(Array.isArray).slice(0, 2), [
    ["loadfile", "/tmp/a.wav", "replace"], ["loadfile", "/tmp/b.wav", "append"],
  ]);
  assert.equal(engine.snapshot().source, "/tmp/a.wav");
  await engine.close();
}

// Gate a middle batch: queued controls and Plays cannot interleave; close can
// bypass the job and must prevent every remaining batch and queued Play.
for (const closeDuringLoad of [false, true]) {
  const bridge = fixture(), engine = new RadioEngine(bridge);
  const request = bridge.request;
  let enter, release, requests = 0;
  const entered = new Promise(resolve => { enter = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  bridge.request = async wire => {
    await request(wire);
    if (++requests === 2) { enter(); await gate; }
    return [];
  };
  const sources = Array.from({ length: 1000 }, (_, i) => `/tmp/${i}.wav`);
  const playing = engine.play(sources);
  const stopping = engine.stop();
  const replacing = engine.play("/tmp/replacement.wav");
  await entered;
  assert.ok(requests === 2 && bridge.calls.filter(Array.isArray).length < 1000);
  assert.ok(!bridge.calls.some(c => Array.isArray(c) && c[0] === "stop"));
  if (closeDuringLoad) await engine.close();
  release();
  await Promise.all([playing, stopping, replacing]);
  const loads = bridge.calls.filter(c => Array.isArray(c) && c[0] === "loadfile");
  if (closeDuringLoad) {
    assert.equal(requests, 2, "close cancels remaining batches without waiting for load");
    assert.equal(engine.snapshot().status, "closed");
  } else {
    assert.deepEqual(loads.map(c => c[1]), [...sources, "/tmp/replacement.wav"]);
    const stop = bridge.calls.findIndex(c => Array.isArray(c) && c[0] === "stop");
    assert.equal(bridge.calls[stop - 1][0], "set_property");
    assert.deepEqual(bridge.calls[stop + 1], ["loadfile", "/tmp/replacement.wav", "replace"]);
  }
  await engine.close();
}
// Loss halfway through a queue restarts with replace and replays the entire
// requested order on the fresh receiver, never just the unacknowledged suffix.
{
  const bridge = fixture(), engine = new RadioEngine(bridge);
  const request = bridge.request;
  let requests = 0;
  bridge.request = async wire => {
    if (++requests === 2) throw new ReceiverGone("lost during queue");
    return request(wire);
  };
  const sources = Array.from({ length: 1000 }, (_, i) => `/tmp/${i}.wav`);
  assert.equal((await engine.play(sources)).error, null);
  assert.equal(bridge.calls.filter(c => c === "start").length, 2);
  const loads = bridge.calls.filter(c => Array.isArray(c) && c[0] === "loadfile");
  const recovered = loads.findIndex((c, i) => i > 0 && c[2] === "replace");
  assert.ok(recovered > 0);
  assert.deepEqual(loads.slice(recovered).map(c => c[1]), sources);
  await engine.close();
}

// Exercise the actual bridge generation/cancellation logic with a gated exec.
for (const blockAction of ["close", "start"]) {
  const calls = [];
  let generation = 0, release, entered;
  const pending = new Promise((resolve) => { release = resolve; });
  const blocked = new Promise((resolve) => { entered = resolve; });
  let gate = false;
  const bridge = receiverClient({ script: "receiver.py", newToken: () => String(++generation),
    exec: async (program, args) => {
      if (program === "mpv") return { code: 0 };
      const [, action, token] = args;
      calls.push([action, token]);
      if (gate && action === blockAction) { gate = false; entered(); await pending; }
      return { code: 0, stdout: "" };
    } });
  const engine = new RadioEngine(bridge);
  await engine.play(source);
  // ReceiverGone from poll, as opposed to arbitrary mpv command failure.
  const original = bridge.request;
  bridge.request = async () => { throw new ReceiverGone("expired"); };
  await engine.poll();
  bridge.request = original;
  gate = true;
  const recovery = engine.play(source);
  await blocked;
  await engine.close();
  release(); await recovery;
  assert.equal(engine.snapshot().status, "closed");
  assert.equal(generation, blockAction === "close" ? 1 : 2);
  if (generation === 2) assert.ok(calls.some(([a, t]) => a === "close" && t === "2"));
  const count = calls.length;
  await engine.play(source); await engine.poll();
  assert.equal(calls.length, count, "Final close must cancel every future generation");
}
{
  let result = { code: 3, stderr: "Receiver closed" };
  const bridge = receiverClient({ script: "receiver.py", newToken: () => "session",
    exec: async (_program, args) => args[1] === "start" ? { code: 0, stdout: "" } : result });
  await bridge.start();
  await assert.rejects(bridge.request(command("stop")), ReceiverGone);
  result = { code: 0, stdout: '{"request_id":1,"error":"command failed"}\n' };
  await assert.rejects(bridge.request(command("stop")), (e) => !(e instanceof ReceiverGone));
  result = { code: 1, stderr: "timed out" };
  await assert.rejects(bridge.request(command("stop")), (e) => !(e instanceof ReceiverGone));
}
console.log("ipc.check ok (protocol, metadata, lifecycle, missing mpv, recovery generations)");
