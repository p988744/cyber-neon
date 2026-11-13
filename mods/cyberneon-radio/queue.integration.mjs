// node mods/cyberneon-radio/queue.integration.mjs — real mpv, generated silence only
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, symlink, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RadioEngine } from "./engine.js";
import { receiverClient } from "./receiver-client.js";
import { command } from "./ipc.js";

const script = fileURLToPath(new URL("./receiver.py", import.meta.url));
const tokens = [];
function exec(program, args, options = {}) {
  return new Promise((resolve, reject) => execFile(program, args, { timeout: options.timeout ?? 7000 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number") reject(error);
    else resolve({ code: error?.code ?? 0, stdout, stderr });
  }));
}
const bridge = receiverClient({ script, exec, newToken: () => {
  const token = randomBytes(16).toString("hex"); tokens.push(token); return token;
} });
const engine = new RadioEngine(bridge);
const folder = await mkdtemp(join(tmpdir(), "radio-queue-"));
try {
  const media = join(folder, "silence.wav");
  const wav = Buffer.alloc(44 + 8000 * 2 * 120);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  await writeFile(media, wav);
  const tracks = Array.from({ length: 1000 }, (_, i) => join(folder, `${String(i).padStart(4, "0")}.wav`));
  await Promise.all(tracks.map(path => symlink(media, path)));
  for (const count of [500, 1000, 1000]) {
    const expected = tracks.slice(0, count);
    const start = Date.now();
    const state = await engine.play(expected);
    assert.equal(state.error, null, `${count}-track Play: ${state.error}`);
    assert.equal(state.status, "loading");
    const playlist = (await bridge.request(command("get", "playlist")))[0].data;
    assert.deepEqual(playlist.map(entry => entry.filename), expected, "all tracks acknowledged in exact order");
    assert.equal(tokens.length, 1, "large queues reuse receiver");
    console.log(`queue.integration: ${count} tracks loaded in ${Date.now() - start}ms`);
  }
  // A control and replacement requested during a long Play must run afterward.
  const pending = engine.play(tracks);
  const pause = engine.pause(true);
  const replacement = engine.play(tracks.slice(7, 9));
  await pending;
  assert.equal((await pause).status, "paused");
  assert.equal((await replacement).error, null);
  const playlist = (await bridge.request(command("get", "playlist")))[0].data;
  assert.deepEqual(playlist.map(entry => entry.filename), tracks.slice(7, 9));
  // Close immediately after a real middle batch acknowledgment. Remaining
  // batches and an already-enqueued replacement must never reach the receiver.
  const request = bridge.request;
  let requests = 0;
  bridge.request = async (...args) => {
    requests++;
    const result = await request(...args);
    if (requests === 2) await engine.close();
    return result;
  };
  const closing = engine.play(tracks);
  const afterClose = engine.play(tracks.slice(0, 2));
  assert.equal((await closing).status, "closed");
  assert.equal((await afterClose).status, "closed");
  assert.equal(requests, 2, "close stops all remaining batches and queued plays");
  assert.equal(tokens.length, 1, "close never starts a replacement receiver");
  console.log("queue.integration ok (500/1000 tracks, repeated replacement, serialized controls, midbatch close)");
} finally {
  await engine.close();
  for (const token of tokens) {
    await exec("python3", [script, "close", token]);
    const root = `/tmp/cnr-${token}`;
    // Wait for our guardian only, before removing its scratch session.
    for (let attempt = 0; attempt < 160; attempt++) {
      try { await access(join(root, "done")); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await rm(root, { recursive: true, force: true });
  }
  await rm(folder, { recursive: true, force: true });
}
