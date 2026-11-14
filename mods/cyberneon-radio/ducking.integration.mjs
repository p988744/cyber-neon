import { sessionRoot, silentReceiver } from "./test-platform.mjs";
// Native receiver adapter + real mpv. Generated silence, scratch sessions only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, access, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RadioEngine } from "./engine.js";
import { receiverClient } from "./receiver-client.js";
import { Ducking, DUCK_MS } from "./ducking.js";
import { Tuner } from "./tuner.js";
import { command } from "./ipc.js";
const script = fileURLToPath(new URL("receiver.py", import.meta.url)), tokens = [];
const exec = (program, args, options = {}) => new Promise((resolve, reject) =>
  execFile(program, args, { timeout: options.timeout ?? 7000 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number") reject(error);
    else resolve({ code: error?.code ?? 0, stdout, stderr });
  }));
const bridge = receiverClient({ exec, script, newToken: () => {
  const token = randomBytes(16).toString("hex"); tokens.push(token); return token;
} });
silentReceiver(bridge);
const engine = new RadioEngine(bridge), duck = new Ducking(engine);
const folder = await mkdtemp(join(tmpdir(), "radio-duck-"));
const media = join(folder, "silent.wav"), station = { name: "Silence fixture", url: media };
const store = { snapshot: () => ({ stations: [station] }), prepare: async s => ({ station: s, source: s.url }) };
const tuner = new Tuner(engine, store); tuner.setVolumeControl(duck);
let now = 1000;
const observe = status => duck.observe([], [{ address: "t1", state: "live", status }], now);
const get = async property => (await bridge.request(command("get", property)))[0].data;
try {
  const wav = Buffer.alloc(44 + 16000 * 30);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(media, wav);
  await observe("working"); await observe("blocked"); assert.deepEqual(tokens, []);
  await tuner.volume(70); await tuner.power(); assert.equal(engine.snapshot().error, null);
  await engine.pause(true);
  await observe("working"); await observe("blocked"); assert.equal(await get("volume"), 14);
  assert.equal(await get("pause"), true, "duck cannot resume a paused receiver");
  await tuner.volume(30); await tuner.mute();
  assert.equal(await get("volume"), 6); assert.equal(await get("mute"), true);
  now += DUCK_MS; await observe("blocked");
  assert.equal(await get("volume"), 30); assert.equal(await get("mute"), true);
  await observe("working"); await observe("blocked"); await duck.setEnabled(false);
  assert.equal(await get("volume"), 30);
  await duck.setEnabled(true); await observe("working"); await observe("blocked");
  const root = sessionRoot(tokens.at(-1));
  const pid = await readFile(join(root, "pid"), "utf8");
  await utimes(join(root, "lease"), new Date(0), new Date(0));
  for (let i = 0; i < 160; i++) {
    try { await access(join(root, "done")); break; } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  await access(join(root, "done"));
  await engine.poll(); await observe("blocked");
  assert.equal(engine.started, false); assert.equal(duck.until, 0); assert.equal(tokens.length, 1);
  await tuner.power(); assert.equal(engine.snapshot().error, null);
  assert.equal(tokens.length, 2);
  assert.notEqual(await readFile(join(sessionRoot(tokens.at(-1)), "pid"), "utf8"), pid);
  assert.equal(await get("volume"), 30); assert.equal(await get("mute"), true);
  await observe("working"); await observe("blocked");
  duck.close(); tuner.close(); await engine.close();
  now += DUCK_MS; await observe("working"); await duck.volume(90);
  assert.equal(engine.snapshot().status, "closed"); assert.equal(tokens.length, 2);
  console.log("ducking.integration ok (native gain/mute/pause, manual intent, disable, expiry recovery, final close)");
} finally {
  duck.close(); await engine.close();
  for (const token of tokens) {
    await exec("python3", [script, "close", token]);
    for (let i = 0; i < 160; i++) {
      try { await access(join(sessionRoot(token), "done")); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await rm(sessionRoot(token), { recursive: true, force: true });
  }
  await rm(folder, { recursive: true, force: true });
}
