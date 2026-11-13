// Inspect actual view descriptions and invoke handlers using a small host shim.
// Native builder validation is separate: render.check.mjs uses herdr-app check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Tuner, staticFrames } from "./tuner.js";
let animations = true;
class Element {
  constructor() {
    this.items = []; this.calls = [];
    const proxy = new Proxy(this, { get: (target, key) => key in target ? target[key] : (...args) => { target.calls.push([key, ...args]); return proxy; } });
    return proxy;
  }
  child(value) { this.items.push(value); return this; }
  children(values) { this.items.push(...values); return this; }
  when(test, callback) { return test ? callback(this) : this; }
}
const part = { new: () => new Element() };
const host = {
  View: class {}, div: () => new Element(), h_flex: () => new Element(), v_flex: () => new Element(),
  Popover: part, Slider: part, SliderTrack: part, SliderIndicator: part, SliderThumb: part,
  theme: () => ({}), shared: () => animations, staticFrames, Tuner,
};
globalThis.__radioTest = host;
let source = await readFile(new URL("main.js", import.meta.url), "utf8");
source = source.replace(/^import .+;\n/gm, "");
source = `const {${Object.keys(host).join(",")}} = globalThis.__radioTest;\n` + source;
const { default: Radio } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const stations = [{ name: "Fixture One", url: "https://example.invalid/one", explicit: true, contentWarning: "Explicit content" }];
const state = { source: null, title: "", error: null, status: "idle" };
const engine = { snapshot: () => ({ ...state }) };
const store = { snapshot: () => ({ stations, loading: false, error: null, path: "/fixture/stations.json" }) };
const view = new Radio();
Object.assign(view, { engine, store, tuner: new Tuner(engine, store), open: false, tuning: 0, volume: { value: () => 50 } });
function all(root) {
  if (!root || typeof root !== "object") return [];
  return [root, ...root.items.flatMap(all), ...root.calls.filter(([name]) => ["content", "trigger"].includes(name)).flatMap(([, el]) => all(el))];
}
const nodes = () => all(view.render());
const texts = () => nodes().flatMap(n => n.items).filter(x => typeof x === "string");
const hasCall = name => nodes().some(n => n.calls.some(([key]) => key === name));
assert.ok(texts().includes("RADIO"));
assert.ok(texts().includes("OFF"));
assert.ok(texts().includes("Explicit content"));
let popover = nodes().find(n => n.calls.some(([k, id]) => k === "id" && id === "radio-tuner"));
// Component identity belongs to native Popover.new; the on_open_change handler
// is what keeps the owner controlled as the chip and outside press toggle it.
popover = nodes().find(n => n.calls.some(([k]) => k === "on_open_change"));
let notified = 0;
popover.calls.find(([k]) => k === "on_open_change")[1](true, { notify: () => notified++ });
assert.equal(view.open, true); assert.equal(notified, 1);
state.source = "test"; state.status = "playing";
state.title = "A synthetic now playing line with enough text to scroll past the visible panel";
view.tuner.playing = stations[0]; view.tuning = 1;
assert.ok(texts().includes("Fixture One"));
assert.equal(hasCall("frames"), true);
assert.equal(hasCall("loop"), true);
stations.length = 0;
assert.ok(texts().includes("ON AIR // Fixture One"));
assert.ok(texts().includes("Explicit content")); // keep warning for removed playing station
stations.push(view.tuner.playing);
animations = false;
assert.equal(hasCall("frames"), false);
assert.equal(hasCall("loop"), false);
assert.ok(texts().includes(state.title));
const actionCalls = [];
view.act = (...args) => actionCalls.push(args);
for (const [id, action] of [["radio-next", "next"], ["radio-prev", "prev"], ["radio-power", "power"], ["radio-mute", "mute"], ["radio-station-0", "choose"]]) {
  const node = nodes().find(n => n.calls.some(([k, value]) => k === "id" && value === id));
  node.calls.find(([key]) => key === "on_click")[1]({}, {});
  assert.equal(actionCalls.at(-1)[0], action);
}
const layout = JSON.parse(await readFile(new URL("../../layouts/Cyber-Neon.json", import.meta.url), "utf8"));
const work = layout.children.find(n => n.id === "work"), status = work.children.at(-1);
assert.equal(status.size.px, 28);
assert.equal(status.children.filter(n => n.content?.mod === "cyberneon-radio").length, 1);
assert.equal(JSON.stringify(layout.children.find(n => n.id === "sidebar")).includes("cyberneon-radio"), false);
const keys = JSON.parse(await readFile(new URL("../../keys.json", import.meta.url), "utf8"));
assert.deepEqual(Object.keys(keys), ["layout:Cyber-Neon"]);
for (const command of ["next", "prev", "mute"]) assert.ok(Object.values(keys["layout:Cyber-Neon"]).includes(`cyberneon-radio.${command}`));
// Regression: actual keyboard handler + controller must present the explicit
// station before loading it, even with the tuner initially closed / ANIM OFF.
const find = (root, id) => all(root).find(n => n.calls.some(([k, value]) => k === "id" && value === id));
const contentTexts = root => all(root).flatMap(n => n.items).filter(x => typeof x === "string");
const explicitStation = { name: "Explicit fixture", url: "/explicit.wav", explicit: true, contentWarning: "Explicit content" };
const cleanStation = { name: "Clean fixture", url: "/clean.wav", explicit: false };
for (const command of ["next", "prev"]) {
  let entries = [cleanStation, explicitStation];
  const current = { source: cleanStation.url, status: "playing", error: null };
  let loads = [];
  const actualEngine = {
    snapshot: () => ({ ...current }),
    play: async source => { loads.push(source); Object.assign(current, { source, status: "loading" }); },
    volume: async () => {}, mute: async () => {}, stop: async () => { current.source = null; },
    close: async () => { current.source = null; },
  };
  const actualStore = {
    snapshot: () => ({ stations: entries.map(s => ({ ...s })), loading: false }),
    prepare: async station => ({ station, source: station.url }),
  };
  const radio = new Radio();
  Object.assign(radio, { engine: actualEngine, store: actualStore, tuner: new Tuner(actualEngine, actualStore),
    open: false, warning: null, warningReady: null, warningGeneration: 0, tuning: 0, volume: { value: () => 50, release() {} } });
  radio.tuner.select(cleanStation); radio.tuner.playing = cleanStation;
  const tasks = [];
  const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); }, timer: { after() {} } };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  radio.command(command, cx);
  await flush();
  assert.equal(radio.open, true, "keyboard action opens the normal tuner");
  assert.equal(radio.tuner.station().name, explicitStation.name);
  assert.deepEqual(loads, [], "no explicit load before the warning's native layout");
  let tree = radio.render();
  let warning = find(tree, "radio-warning-1");
  assert.ok(warning);
  assert.ok(contentTexts(warning).includes("Explicit content // Explicit fixture"));
  warning.calls.find(([name]) => name === "on_size_change")[1]({ width: 200, height: 16 }, cx);
  await Promise.all(tasks);
  assert.deepEqual(loads, [explicitStation.url]);
  radio.setOpen(false, cx);
  let chip = find(radio.render(), "radio-chip");
  assert.ok(contentTexts(chip).includes(explicitStation.name));
  assert.ok(contentTexts(chip).includes("EXPLICIT"));
  assert.match(chip.calls.find(([name]) => name === "tooltip")[1], /Explicit content/);
  entries = [cleanStation]; // removed-but-playing warning must survive collapse
  chip = find(radio.render(), "radio-chip");
  assert.ok(contentTexts(chip).includes("EXPLICIT"));
  assert.ok(contentTexts(chip).includes(explicitStation.name));

  // Dismissal before layout cancels only this pending tune. No confirmation
  // control, extra dialog, or receiver replacement is introduced.
  entries = [cleanStation, explicitStation];
  current.source = cleanStation.url;
  radio.tuner.select(cleanStation); radio.tuner.playing = cleanStation;
  loads = [];
  radio.command(command, cx); await flush();
  radio.setOpen(false, cx); await Promise.all(tasks);
  assert.deepEqual(loads, []);
  assert.equal(current.source, cleanStation.url);

  // Keyboard browsing while off still presents the selected warning, without
  // preparing/loading anything or claiming the receiver is on.
  current.source = null;
  radio.tuner.select(cleanStation);
  radio.command(command, cx); await Promise.all(tasks);
  assert.equal(radio.open, true);
  assert.ok(contentTexts(radio.render()).includes("Explicit content"));
  assert.deepEqual(loads, []);
  assert.equal(find(radio.render(), "radio-explicit"), undefined);

  // Closing the owner while the warning waits must unblock without playing.
  current.source = cleanStation.url;
  radio.tuner.select(cleanStation);
  radio.command(command, cx); await flush();
  warning.calls.find(([name]) => name === "on_size_change")[1]({ width: 200, height: 16 }, cx);
  await flush();
  assert.deepEqual(loads, [], "stale layout callback cannot release a newer warning");
  await radio.close(); await Promise.all(tasks);
  assert.deepEqual(loads, []);
}
delete globalThis.__radioTest;
console.log("view controls, motion switch, status placement and layout keys passed");
