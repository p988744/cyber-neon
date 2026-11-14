import assert from "node:assert/strict";
import { StationStore } from "./stations.js";
import { Tuner } from "./tuner.js";

let disk = [{ name: "A", url: "https://a.invalid/" }, { name: "B", url: "https://b.invalid/" }];
const calls = [];
const adapter = { path: "/fixture/radio.json", read: async () => JSON.stringify(disk), resolve: async url => url,
  remove: async source => { calls.push(source); disk = disk.filter(s => s.url !== source); } };
const store = new StationStore(adapter);
await store.refresh();
assert.equal(store.snapshot().stations.length, 2);
const snapshot = await store.remove(store.snapshot().stations[0]);
assert.deepEqual(calls, ["https://a.invalid/"]);
assert.deepEqual(snapshot.stations.map(s => s.name), ["B"]);

// The adapter claims success but the station is still listed: surfaced, not hidden.
const stuck = new StationStore({ ...adapter, remove: async () => {} });
await stuck.refresh();
await assert.rejects(stuck.remove(stuck.snapshot().stations[0]), /still listed/);
// A read-only adapter cannot remove.
await assert.rejects(new StationStore({ path: "/x", read: async () => "[]", resolve: async u => u }).remove({ name: "A", url: "https://a.invalid/" }), /read-only/);

// Tuner: removal never stops playback and falls back to the first station.
const engine = { snapshot: () => ({ source: "https://b.invalid/" }) };
const tuner = new Tuner(engine, store);
tuner.select({ name: "B", url: "https://b.invalid/" });
await tuner.remove({ name: "B", url: "https://b.invalid/" });
assert.equal(tuner.error, null);
assert.equal(tuner.stations().length, 0);
assert.equal(tuner.station(), null);
console.log("remove.check ok");
