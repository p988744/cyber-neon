// node mods/cyberneon-radio/recovery.integration.mjs (requires local python3 + mpv)
// Actual engine + actual bridge client + guardian + mpv; generated silence only.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, readFile, utimes, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RadioEngine } from "./engine.js";
import { receiverClient } from "./receiver-client.js";
import { command } from "./ipc.js";

const script = fileURLToPath(new URL("./receiver.py", import.meta.url));
const tokens = [];
const root = (token = tokens.at(-1)) => `/tmp/cnr-${token}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
const gone = (pid) => { try { process.kill(pid, 0); return false; } catch (e) { if (e.code === "ESRCH") return true; throw e; } };
async function waitFor(check) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await check()) return; await sleep(25); }
  throw new Error("Timed out waiting for guardian cleanup");
}
function exec(program, args, options = {}) {
  return new Promise((resolve, reject) => execFile(program, args, { timeout: options.timeout ?? 7000 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number") reject(error);
    else resolve({ code: error?.code ?? 0, stdout, stderr });
  }));
}

let gate = null;
const bridge = receiverClient({ script, newToken: () => {
  const token = randomBytes(16).toString("hex"); tokens.push(token); return token;
}, exec: async (program, args, options) => {
  if (gate && args[1] === "start") { const current = gate; gate = null; current.enter(); await current.wait; }
  return exec(program, args, options);
} });
const engine = new RadioEngine(bridge);
const folder = await mkdtemp(join(tmpdir(), "radio-recovery-"));
try {
  const media = join(folder, "silence.wav");
  const wav = Buffer.alloc(44 + 8000 * 2 * 60);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(media, wav);
  async function pid() { return Number(await readFile(join(root(), "pid"), "utf8")); }
  async function expire() {
    const oldRoot = root(), oldPid = await pid();
    await utimes(join(oldRoot, "lease"), new Date(Date.now() - 30000), new Date(Date.now() - 30000));
    await waitFor(async () => gone(oldPid) && await exists(join(oldRoot, "done")));
    return oldPid;
  }

  await engine.play(media);
  assert.equal(engine.snapshot().status, "loading");
  await engine.volume(23); await engine.mute(true);
  const firstPid = await pid();
  // A real mpv command error must not retire the player.
  const request = bridge.request;
  bridge.request = () => request(command("get", "nonexistent-radio-property"));
  await engine.pause();
  assert.equal(engine.snapshot().status, "error");
  assert.equal(engine.started, true);
  bridge.request = request;
  await engine.play(media);
  assert.equal(await pid(), firstPid);
  assert.equal(tokens.length, 1);

  await expire();
  await engine.poll();
  assert.equal(engine.started, false);
  await engine.poll(); await engine.pause(false); await engine.mute(false);
  assert.equal(tokens.length, 1, "No automatic restart after receiver expiry");
  await engine.play(media);
  assert.equal(engine.snapshot().status, "loading");
  assert.equal(tokens.length, 2);
  assert.notEqual(await pid(), firstPid);
  const settings = await bridge.request(command("get", "volume", 1) + command("get", "mute", 2));
  assert.deepEqual(settings.map((r) => r.data), [23, true]);

  const secondPid = await expire();
  // No poll this time: the first explicit Play must itself recover and load.
  await engine.play(media);
  assert.equal(engine.snapshot().status, "loading");
  assert.equal(tokens.length, 3);
  assert.notEqual(await pid(), secondPid);
  await engine.poll();
  assert.equal(engine.snapshot().status, "playing");

  await expire();
  let enter, release;
  const entered = new Promise((resolve) => { enter = resolve; });
  const wait = new Promise((resolve) => { release = resolve; });
  gate = { enter, wait };
  const recovery = engine.play(media);
  await entered; // replacement token allocated, but launcher not yet dispatched
  assert.equal(tokens.length, 4);
  await engine.close();
  release(); await recovery;
  assert.equal(engine.snapshot().status, "closed");
  assert.equal(await exists(join(root(), "closed")), true);
  assert.equal(await exists(join(root(), "pid")), false);
  assert.equal(await exists(join(root(), "started")), false);
  await engine.play(media); await engine.poll();
  assert.equal(tokens.length, 4, "Final close must never allocate a new generation");
  assert.equal(new Set(tokens).size, tokens.length);
  console.log("recovery.integration ok (real mpv expiry → explicit Play, no auto-play, preserved settings, final cancellation)");
} finally {
  await engine.close();
  for (const token of tokens) {
    await exec("python3", [script, "close", token]);
    await waitFor(async () => !await exists(join(root(token), "started")) || await exists(join(root(token), "done")));
    await rm(root(token), { recursive: true, force: true });
  }
  await rm(folder, { recursive: true, force: true });
}
