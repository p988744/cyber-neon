import { sessionRoot, silentReceiver } from "./test-platform.mjs";
// Actual #8 localStations adapter + UI controller + engine/bridge/mpv.
// Scratch config and generated silence only; never touch the user's config/app.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Tuner } from "./tuner.js";
import { RadioEngine } from "./engine.js";
import { receiverClient } from "./receiver-client.js";
import { command } from "./ipc.js";
import { Ducking } from "./ducking.js";
import { RadioSearch } from "./search.js";

const root = await realpath(await mkdtemp(join(tmpdir(), "radio-tuner-音樂 ")));
const tokens = [];
const exec = (program, args, options = {}) => new Promise((resolve, reject) =>
  execFile(program, args, { timeout: options.timeout ?? 7000 }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number") reject(error);
    else resolve({ code: error?.code ?? 0, stdout, stderr });
  }));
const bridge = receiverClient({ exec, script: fileURLToPath(new URL("receiver.py", import.meta.url)),
  newToken: () => { const token = randomBytes(16).toString("hex"); tokens.push(token); return token; } });
silentReceiver(bridge);
const engine = new RadioEngine(bridge), ducking = new Ducking(engine);
let clock = 1000;
const observe = status => ducking.observe([], [{ address: "fixture/t1", state: "live", status }], clock++);
try {
  const folder = join(root, "mods/cyberneon-radio");
  await mkdir(folder, { recursive: true });
  await copyFile(new URL("station-files.py", import.meta.url), join(folder, "station-files.py"));
  // Supply only Herdr's two host capabilities. Execute the actual adapter code.
  globalThis.__stationHost = { exec, appHome: () => root };
  const adapter = (await readFile(new URL("station-storage.js", import.meta.url), "utf8"))
    .replace('import { exec, appHome } from "herdr";', 'const {exec,appHome} = globalThis.__stationHost;')
    .replace('"./stations.js"', JSON.stringify(new URL("stations.js", import.meta.url).href));
  const { localStations } = await import(`data:text/javascript;base64,${Buffer.from(adapter).toString("base64")}`);
  const opened = [];
  const store = localStations(), tuner = new Tuner(engine, store, async url => { opened.push(url); });
  tuner.setVolumeControl(ducking);
  await observe("working");
  assert.equal(normalize(store.snapshot().path), join(root, "radio.json"));
  await store.refresh();
  assert.equal(tuner.station(), null);
  assert.deepEqual(tokens, []);
  await mkdir(join(root, "tracks"));
  const wav = Buffer.alloc(44 + 8000 * 2 * 30);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(wav.length - 44, 40);
  const first = join(root, "tracks/01 音樂.wav"), second = join(root, "tracks/02 音樂.wav");
  await writeFile(first, wav); await writeFile(second, wav);
  const stations = [{ name: "音樂 folder", url: "tracks", explicit: true },
    { name: "Synthetic file", url: "tracks/02 音樂.wav" }, { name: "Synthetic browser", open: "https://example.invalid" }];
  await writeFile(join(root, "radio.json"), JSON.stringify(stations));
  await store.refresh();
  assert.equal(tuner.station().contentWarning, "Explicit content");
  assert.deepEqual(tokens, [], "list load must not allocate receiver");
  await tuner.volume(17); await tuner.mute();
  assert.deepEqual(tokens, []);
  let showWarning, enteredWarning;
  const warningShown = new Promise(resolve => { showWarning = resolve; });
  const warningEntered = new Promise(resolve => { enteredWarning = resolve; });
  const play = tuner.power(async station => {
    assert.equal(station.contentWarning, "Explicit content");
    enteredWarning();
    return warningShown;
  });
  await warningEntered;
  assert.deepEqual(tokens, [], "explicit warning precedes receiver allocation/load");
  showWarning(true); await play;
  assert.equal(tuner.error, null); assert.equal(engine.snapshot().error, null);
  assert.equal(tuner.playing.name, "音樂 folder");
  assert.equal(engine.snapshot().volume, 17); assert.equal(engine.snapshot().muted, true);
  let queue = await bridge.request(command("get", "playlist"));
  assert.deepEqual(queue[0].data.map(p => p.filename), [first, second]);
  await tuner.step(1);
  assert.equal(tuner.playing.name, "Synthetic file");
  queue = await bridge.request(command("get", "playlist"));
  assert.deepEqual(queue[0].data.map(p => p.filename), [second]);
  assert.equal(tokens.length, 1, "UI tuning reuses the layout receiver");
  await writeFile(join(root, "radio.json"), "["); await store.refresh();
  assert.ok(store.snapshot().error); assert.equal(tuner.stations().length, 3);
  assert.equal(tuner.playing.name, "Synthetic file");
  await observe("blocked");
  assert.ok(Math.abs((await bridge.request(command("get", "volume")))[0].data - 3.4) < 0.001);
  await tuner.choose(tuner.stations()[2]);
  await observe("blocked");
  assert.equal(ducking.until, 0, "browser stop cancels temporary gain");
  assert.equal(engine.snapshot().volume, 17);
  assert.equal(engine.snapshot().muted, true);
  assert.equal(tuner.error, null);
  assert.deepEqual(opened, ["https://example.invalid/"]);
  assert.equal(tuner.playing, null);
  assert.equal(tuner.browserOpened.name, "Synthetic browser");
  assert.equal(engine.snapshot().source, null);
  queue = await bridge.request(command("get", "playlist"));
  assert.deepEqual(queue[0].data, [], "browser handoff unloads the real local queue");
  assert.equal(tokens.length, 1);
  await tuner.power(); assert.equal(tuner.on(), false); assert.equal(tuner.browserOpened, null);
  await tuner.choose(tuner.stations()[1]); await tuner.power();
  assert.equal(tuner.playing.name, "Synthetic file");
  assert.equal(tokens.length, 1, "returning from browser handoff reuses the layout receiver");
  await observe("working"); await observe("blocked");
  const search = new RadioSearch({ search: async () => [{ name: "Directory fixture", url_resolved: "https://example.invalid/never-played", countrycode: "TW", codec: "MP3", bitrate: 128, lastcheckok: 1 }] }, store);
  await search.search("ambient");
  const result = search.snapshot().results[0];
  await search.add(result);
  assert.ok(search.snapshot().error, "Add reports the malformed disk edit without replacing it");
  assert.equal(await readFile(join(root, "radio.json"), "utf8"), "[");
  const manual = { name: "Unsynchronized manual edit", url: "tracks/01 音樂.wav", extra: { keep: true } };
  await writeFile(join(root, "radio.json"), JSON.stringify([...stations, manual]));
  const selected = tuner.selected;
  await search.add(result);
  assert.equal(search.snapshot().error, null);
  assert.equal(tuner.stations().length, 5, "actual owner store publishes Add plus the latest manual edit");
  assert.deepEqual(JSON.parse(await readFile(join(root, "radio.json"), "utf8"))[3], manual);
  assert.equal(tuner.selected, selected, "Add never chooses a station");
  assert.equal(tuner.playing.name, "Synthetic file");
  assert.equal(engine.snapshot().source, second, "Search/Add never load the directory stream");
  assert.equal(tokens.length, 1, "Search/Add allocate no receiver");
  queue = await bridge.request(command("get", "playlist"));
  assert.deepEqual(queue[0].data.map(p => p.filename), [second]);
  assert.ok(Math.abs(engine.snapshot().volume - 3.4) < 0.001, "Search/Add do not change duck gain");
  await ducking.setEnabled(false);
  assert.equal((await bridge.request(command("get", "volume")))[0].data, 17);
  assert.equal((await bridge.request(command("get", "mute")))[0].data, true);
  await tuner.power(); assert.equal(tuner.on(), false);
  await rm(join(root, "radio.json")); await store.refresh();
  assert.equal(tuner.station(), null); assert.equal(store.snapshot().error, null);
  tuner.close(); ducking.close(); await engine.close();
  assert.equal(engine.snapshot().status, "closed");
  console.log("tuner.integration ok (actual localStations, Search/Add persistence without tuning, ducking across Search/Add and browser stop/handoff/return, queues, one receiver)");
} finally {
  ducking.close(); await engine.close();
  delete globalThis.__stationHost;
  for (const token of tokens) {
    await exec("python3", [fileURLToPath(new URL("receiver.py", import.meta.url)), "close", token]);
    for (let attempt = 0; attempt < 160; attempt++) {
      try { await access(join(sessionRoot(token), "done")); break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await rm(sessionRoot(token), { recursive: true, force: true });
  }
  await rm(root, { recursive: true, force: true });
}
