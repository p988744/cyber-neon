// Exercise eager native panel construction in each state without changing the
// live layout, reading user stations, starting mpv, or making any network call.
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const dir = await mkdtemp(join(tmpdir(), "radio-ui-check-"));
try {
  for (const name of ["engine.js", "bridge.js", "receiver-client.js", "ipc.js", "tuner.js", "stations.js", "search.js", "search-client.js", "search-ui.js", "mod.json"])
    await copyFile(new URL(name, import.meta.url), join(dir, name));
  await writeFile(join(dir, "station-storage.js"), `export function localStations() { return { snapshot: () => ({stations: [], loading: false, error: null, path: '/test/stations.json'}), refresh: async () => {} }; }`);
  const source = (await readFile(new URL("main.js", import.meta.url), "utf8")).replace("export default class Radio", "class Radio");
  const fixtures = [
    { name: "empty", stations: [], loading: false, error: null },
    { name: "loading", stations: [], loading: true, error: null },
    { name: "explicit-playing", stations: [{ name: "Synthetic station with a long name", url: "https://example.invalid/test", explicit: true, contentWarning: "Explicit content", genre: "Test", note: "Synthetic check fixture" }], playing: true, loading: false },
    { name: "explicit-before-play", stations: [{ name: "Synthetic explicit station", url: "/test/explicit.wav", explicit: true, contentWarning: "Explicit content" }], warning: true, loading: false },
    { name: "explicit-collapsed", stations: [{ name: "Synthetic explicit station", url: "/test/explicit.wav", explicit: true }], playing: true, collapsed: true, loading: false },
    { name: "config-error", stations: [], loading: false, error: "Invalid JSON // last good list retained" },
    { name: "search-results", stations: [], loading: false, search: { results: [{ name: "Directory fixture", url: "https://example.invalid/live", country: "Taiwan", codec: "MP3", bitrate: 128, lastCheckOK: true, lastCheck: "2026-11-13T00:00:00Z" }] } },
    { name: "search-error", stations: [], loading: false, search: { error: "Radio Browser unavailable; retry Search" } },
  ];
  for (const fixture of fixtures) {
    await writeFile(join(dir, "main.js"), source + `\nexport default class Fixture extends Radio { init(p,cx) { super.init(p,cx); const f = ${JSON.stringify(fixture)}; this.open=!f.collapsed; this.tuning=1; if(f.warning) this.warning={station:f.stations[0],generation:1}; this.store={snapshot:()=>({...f,path:'/test/stations.json'})}; this.tuner.store=this.store; this.directory.store=this.store; if(f.search) {this.directory.expanded=true; Object.assign(this.directory.model.state,f.search);} if(f.playing) { this.engine.state={...this.engine.state,source:'test',status:'playing',title:'Synthetic track title long enough to scroll across the full tuner display'}; this.tuner.playing=f.stations[0]; } } }`);
    process.stdout.write(`${fixture.name}: `);
    process.stdout.write(execFileSync("herdr-app", ["check", dir], { encoding: "utf8", env: { ...process.env, HERDR_APP_HOME: dir } }));
  }
} finally { await rm(dir, { recursive: true, force: true }); }
