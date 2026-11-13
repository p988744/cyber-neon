// node mods/cyberneon-radio/stations.check.mjs — isolated config + real storage helper
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, mkdir, symlink, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { StationStore, parseStations } from "./stations.js";

const exec = promisify(execFile);
const helper = fileURLToPath(new URL("./station-files.py", import.meta.url));
const root = await realpath(await mkdtemp(join(tmpdir(), "radio-stations-")));
const station = { name: "My music", url: "music", explicit: true, note: "My files" };
async function call(action, value) {
  const result = await exec("python3", [helper, action, root, ...(value === undefined ? [] : [value])]);
  return JSON.parse(result.stdout);
}
const store = new StationStore({ path: join(root, "radio.json"), read: () => call("read"), resolve: (url) => call("resolve", url) });
try {
  await store.refresh();
  assert.deepEqual(store.snapshot().stations, []);
  const events = [];
  const unsubscribe = store.subscribe((s) => events.push(s.loading));
  store.subscribe(() => { throw new Error("observer failure"); });
  await writeFile(join(root, "radio.json"), JSON.stringify([station]));
  const refresh = store.refresh();
  assert.equal(store.refresh(), refresh, "concurrent refresh coalesces");
  await refresh;
  assert.deepEqual(events, [true, false]);
  const snapshot = store.snapshot();
  assert.equal(snapshot.stations[0].contentWarning, "Explicit content");
  snapshot.stations[0].name = "mutated";
  assert.equal(store.snapshot().stations[0].name, "My music");
  await writeFile(join(root, "radio.json"), "[");
  await store.refresh();
  assert.ok(store.snapshot().error);
  assert.equal(store.snapshot().stations.length, 1, "partial edit retains last valid list");
  await writeFile(join(root, "radio.json"), "[]");
  await store.refresh();
  assert.equal(store.snapshot().error, null);
  assert.deepEqual(store.snapshot().stations, []);
  unsubscribe();

  for (const value of [{}, [{ name: "x" }], [{ name: "x", url: "music", explicit: "true" }], [{ name: "x\n", url: "music" }]]) {
    assert.throws(() => parseStations(JSON.stringify(value)));
  }
  assert.equal(parseStations('[{"name":"Web","open":"https://example.invalid"}]')[0].contentWarning, null);
  await assert.rejects(store.prepare({ name: "Web", open: "https://example.invalid" }), /Browser-only/);

  await mkdir(join(root, "music/sub"), { recursive: true });
  const first = join(root, "music/01 a'$().wav"), second = join(root, "music/sub/02.flac");
  await writeFile(first, "test fixture, not decoded");
  await writeFile(second, "test fixture, not decoded");
  await writeFile(join(root, "music/ignored.txt"), "ignored");
  await symlink(join(root, "music"), join(root, "music/sub/loop"));
  let prepared = await store.prepare(station);
  assert.deepEqual(prepared.source, [first, second]);
  assert.equal(prepared.station.contentWarning, "Explicit content");
  assert.equal(await call("resolve", pathToFileURL(first).href), first);
  await writeFile(join(root, "mine.m3u"), `\ufeff#EXTM3U\n#EXTINF:-1,Title\nmusic/01 a'$().wav\nmusic/sub/02.flac\n`);
  assert.deepEqual(await call("resolve", "mine.m3u"), [first, second]);
  await writeFile(join(root, "mine.pls"), `[playlist]\nFile2=music/sub/02.flac\nTitle2=second\nFile1=music/01 a'$().wav\nNumberOfEntries=2\nVersion=2\n`);
  assert.deepEqual(await call("resolve", "mine.pls"), [first, second]);
  await writeFile(join(root, "nested.m3u"), "mine.pls\n");
  assert.deepEqual(await call("resolve", "nested.m3u"), [first, second]);
  await writeFile(join(root, "cycle.m3u"), "cycle.m3u\n");
  await mkdir(join(root, "empty"));
  for (const url of ["missing.wav", "empty", "cycle.m3u", "music/ignored.txt", "file://remote/music.wav", "edl://bad", "https://youtube.com/watch?v=x", "https://api.soundcloud.com/x", "https://somafm.com/x", "https://poolsuite.net/x"]) {
    await assert.rejects(store.prepare({ name: "Bad", url }));
  }
  const stream = "https://example.invalid/live?x=100%25";
  assert.equal((await store.prepare({ name: "User stream", url: stream })).source, stream, "resolver never fetches network");
  await writeFile(join(root, "remote.m3u"), `${stream}\n`);
  assert.equal(await call("resolve", "remote.m3u"), stream);
  await writeFile(join(root, "huge.m3u"), "#".repeat(1024 * 1024 + 1));
  await assert.rejects(call("resolve", "huge.m3u"), /exceeds/);
  await writeFile(join(root, "many.m3u"), Array(1001).fill(stream).join("\n"));
  await assert.rejects(call("resolve", "many.m3u"), /1000/);
  console.log("stations.check ok (live edits, metadata, errors, folders, M3U/PLS, restrictions, bounds)");
} finally { await rm(root, { recursive: true, force: true }); }
