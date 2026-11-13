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
delete globalThis.__radioTest;
console.log("view controls, motion switch, status placement and layout keys passed");
