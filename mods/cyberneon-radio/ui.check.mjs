// Inspect actual view descriptions and invoke handlers using a small host shim.
// Native builder validation is separate: render.check.mjs uses herdr-app check.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Ducking } from "./ducking.js";
import { Tuner, staticFrames, waveFrames, idleWave } from "./tuner.js";
import { RadioSearch, SEARCH_TAGS } from "./search.js";
import { StationStore } from "./stations.js";
let animations = true;
const saved = new Map();
let hostAgents = [], hostTerminals = [];
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
  Input: part, InputState: { new: () => ({ text: "", handlers: {}, on(event, fn) { this.handlers[event] = fn; }, value() { return this.text; }, set_value(text) { this.text = text; }, focus() {}, release() {} }) },
  theme: () => ({}), shared: () => animations, staticFrames, waveFrames, idleWave, Tuner, RadioSearch, SEARCH_TAGS,
  localDirectory: () => ({ search: async () => [] }),
  Ducking,
  localBrowser: () => async () => {},
  RadioEngine: class {
    constructor() { this.started = false; this.state = { source: null, status: "idle" }; }
    snapshot() { return { ...this.state }; }
    async volume(value) { this.state.volume = value; }
    async close() { this.started = false; }
  },
  localReceiver: () => ({}),
  localStations: () => ({ snapshot: () => ({ stations: [] }), refresh: async () => {} }),
  SliderState: { new: () => ({ on() {}, release() {}, value: () => 50 }) },
  agents: () => hostAgents, terminals: () => hostTerminals,
  nextCommand: () => new Promise(() => {}),
  localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) },
};
globalThis.__radioTest = host;
const panelSource = (await readFile(new URL("search-ui.js", import.meta.url), "utf8")).replace(/^import .+;\n/gm, "");
const { DirectoryPanel } = await import(`data:text/javascript;base64,${Buffer.from(`const {${Object.keys(host).join(",")}} = globalThis.__radioTest;\n` + panelSource).toString("base64")}`);
host.DirectoryPanel = DirectoryPanel;
let source = await readFile(new URL("main.js", import.meta.url), "utf8");
source = source.replace(/^import .+;\n/gm, "");
source = `const {${Object.keys(host).join(",")}} = globalThis.__radioTest;\n` + source;
const { default: Radio } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const stations = [{ name: "Fixture One", url: "https://example.invalid/one", explicit: true, contentWarning: "Explicit content" }];
const state = { source: null, title: "", error: null, status: "idle" };
const engine = { snapshot: () => ({ ...state }) };
const store = { snapshot: () => ({ stations, loading: false, error: null, path: "/fixture/stations.json" }) };
const view = new Radio();
Object.assign(view, { engine, store, directory: new DirectoryPanel(store), tuner: new Tuner(engine, store), open: false, tuning: 0, volume: { value: () => 50 } });
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
// Equalizer: chip and panel move only while actually playing with ANIM on.
const byId = id => nodes().find(n => n.calls.some(([k, v]) => k === "id" && v === id));
const framesOf = node => node?.calls.find(([k]) => k === "frames");
assert.equal(framesOf(byId("radio-chip-wave"))?.[1].length, 12);
assert.ok(nodes().some(n => framesOf(n)?.[1][0].length === 36), "panel shows the full-width wave");
state.status = "paused";
assert.equal(framesOf(byId("radio-chip-wave")), undefined);
assert.ok(byId("radio-chip-wave").items.includes(idleWave(5)));
state.status = "playing";
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
// Pin: outside clicks (open=false) are ignored only while pinned; x unpins and closes.
view.open = true; view.pinned = false;
const openChange = () => nodes().find(n => n.calls.some(([k]) => k === "on_open_change")).calls.find(([k]) => k === "on_open_change")[1];
byId("radio-pin").calls.find(([k]) => k === "on_click")[1]({}, { notify() {} });
assert.equal(view.pinned, true); assert.equal(saved.get("pinned"), "on");
openChange()(false, { notify() {} });
assert.equal(view.open, true, "pinned tuner stays open");
byId("radio-close").calls.find(([k]) => k === "on_click")[1]({}, { notify() {} });
assert.equal(view.pinned, false); assert.equal(saved.get("pinned"), "off"); assert.equal(view.open, false);
view.open = true; openChange()(false, { notify() {} });
assert.equal(view.open, false, "unpinned tuner dismisses on outside click");
view.open = false;
// Toggle uses the actual controller; it stays available while tuning and
// persists only the preference, never temporary gain or a playback action.
view.ducking = new Ducking(engine);
view.tuner.pending = 1;
const duckButton = nodes().find(n => n.calls.some(([k, value]) => k === "id" && value === "radio-ducking"));
const toggleTasks = [];
const toggleCx = { notify() {}, spawn(fn) { toggleTasks.push(fn(toggleCx)); } };
duckButton.calls.find(([k]) => k === "on_click")[1]({}, toggleCx);
await Promise.all(toggleTasks);
assert.equal(view.ducking.enabled, false);
assert.equal(saved.get("ducking"), "off");
assert.ok(texts().includes("DUCK OFF"));
view.tuner.pending = 0;
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
  Object.assign(radio, { engine: actualEngine, store: actualStore, directory: new DirectoryPanel(actualStore), tuner: new Tuner(actualEngine, actualStore),
    open: false, dismissalGeneration: 0, warning: null, warningReady: null, warningGeneration: 0, tuning: 0, volume: { value: () => 50, release() {} } });
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
// Exact prepare/dismiss race: cancellation must be captured when the action
// starts, before a warning exists, for both explicit and ordinary stations.
for (const explicit of [true, false]) {
  for (const ending of ["dismiss", "close"]) {
    const target = { name: "Delayed fixture", url: "/delayed.wav", explicit };
    const current = { source: cleanStation.url, status: "playing" };
    const loads = [];
    const engine = {
      snapshot: () => ({ ...current }),
      play: async source => { loads.push(source); Object.assign(current, { source, status: "loading" }); },
      volume: async () => {}, mute: async () => {},
      close: async () => { current.source = null; },
    };
    let releasePrepare, enteredPrepare;
    const gate = new Promise(resolve => { releasePrepare = resolve; });
    const entered = new Promise(resolve => { enteredPrepare = resolve; });
    const store = {
      snapshot: () => ({ stations: [cleanStation, target], loading: false }),
      prepare: async station => { enteredPrepare(); await gate; return { station, source: station.url }; },
    };
    const radio = new Radio();
    Object.assign(radio, { engine, store, directory: new DirectoryPanel(store), tuner: new Tuner(engine, store), open: false,
      dismissalGeneration: 0, warning: null, warningReady: null, warningGeneration: 0, tuning: 0,
      volume: { value: () => 50, release() {} } });
    radio.tuner.select(cleanStation); radio.tuner.playing = cleanStation;
    const tasks = [];
    const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); }, timer: { after() {} } };
    const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
    radio.command("next", cx);
    await entered;
    assert.equal(radio.warningReady, null, "prepare still pending, no warning wait exists");
    if (ending === "dismiss") radio.setOpen(false, cx);
    else await radio.close();
    releasePrepare(); await flush();
    if (ending === "dismiss") {
      assert.equal(radio.open, false, "late prepare must not reopen dismissed tuner");
      assert.equal(current.source, cleanStation.url);
    }
    assert.equal(radio.warning, null);
    assert.deepEqual(loads, [], "late prepare must not load a dismissed/closed action");
    await Promise.all(tasks);
    if (ending === "close") continue;

    // Cancellation invalidates only old actions; repeated controls issued
    // afterward still load, with an independent warning layout each time.
    store.prepare = async station => ({ station, source: station.url });
    for (let attempt = 0; attempt < 2; attempt++) {
      radio.act("choose", cx, target); await flush();
      if (explicit) {
        const warning = find(radio.render(), `radio-warning-${attempt + 1}`);
        assert.ok(warning);
        assert.equal(loads.length, attempt);
        warning.calls.find(([name]) => name === "on_size_change")[1]({ width: 200, height: 16 }, cx);
      }
      await Promise.all(tasks);
      assert.equal(loads.length, attempt + 1);
      assert.equal(loads.at(-1), target.url);
    }
  }
}
// Actual View -> directory buttons -> shared station store -> Tuner list.
// Neither Search nor Add may select/prepare/play, even with a receiver on.
for (const on of [false, true]) {
  let disk = JSON.stringify([cleanStation]);
  let prepares = 0, plays = 0, searches = 0;
  const store = new StationStore({ read: async () => disk,
    save: async station => { disk = JSON.stringify([...JSON.parse(disk), station]); },
    resolve: async url => { prepares++; return url; } });
  await store.refresh();
  const engine = { snapshot: () => ({ source: on ? cleanStation.url : null, status: on ? "playing" : "idle", title: "", error: null }),
    play: async () => { plays++; } };
  const radio = new Radio();
  Object.assign(radio, { engine, store, tuner: new Tuner(engine, store), open: true, tuning: 0, volume: { value: () => 50 } });
  radio.tuner.select(cleanStation);
  if (on) radio.tuner.playing = cleanStation;
  const selected = radio.tuner.selected;
  radio.directory = new DirectoryPanel(store, { search: async tag => {
    searches++; assert.equal(tag, "lofi");
    return [{ name: "Directory fixture", url_resolved: "https://example.invalid/new", country: "Taiwan", codec: "MP3", bitrate: 128, lastcheckok: 1 }];
  } });
  const tasks = [];
  const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); }, timer: { after() { return { cancel() {} }; } } };
  const click = id => find(radio.render(), id).calls.find(([name]) => name === "on_click")[1]({}, cx);
  assert.equal(searches, 0, "opening/rendering tuner never searches");
  click("radio-directory-toggle");
  assert.equal(searches, 0, "expanding directory never searches");
  click("radio-tag-lofi");
  await Promise.all(tasks);
  assert.ok(contentTexts(radio.render()).includes("Directory fixture"));
  assert.ok(contentTexts(radio.render()).includes("Taiwan · MP3 / 128 kbps"));
  click("radio-add-0");
  await Promise.all(tasks);
  assert.equal(store.snapshot().stations.length, 2);
  assert.equal(radio.tuner.stations()[1].name, "Directory fixture");
  assert.ok(contentTexts(radio.render()).includes("SAVED"));
  assert.equal(radio.tuner.selected, selected);
  assert.equal(prepares, 0); assert.equal(plays, 0);
  assert.equal(radio.tuner.on(), on);
}

// Browser handoff uses the same native warning and dismissal-generation gate,
// but must stop local audio rather than preparing/loading the browser station.
for (const ending of ["shown", "dismissed", "queued-dismissal", "closed", "stop-dismissed"]) {
  const browser = { name: "Explicit browser fixture", open: "https://example.invalid/", explicit: true };
  const current = { source: cleanStation.url, status: "playing", error: null };
  const effects = [];
  let releaseStop;
  const stopGate = ending === "stop-dismissed" ? new Promise(resolve => { releaseStop = resolve; }) : null;
  const engine = {
    started: true,
    snapshot: () => ({ ...current }),
    volume: async value => { current.volume = value; },
    stop: async () => { effects.push("stop"); if (stopGate) await stopGate; current.source = null; current.status = "idle"; },
    close: async () => { current.source = null; },
  };
  let entries = [cleanStation, browser];
  const store = {
    snapshot: () => ({ stations: entries, loading: false }),
    prepare: async () => { throw new Error("Browser must bypass prepare"); },
  };
  const radio = new Radio();
  Object.assign(radio, { engine, store, directory: new DirectoryPanel(store), tuner: new Tuner(engine, store, async url => { effects.push(url); }), open: false,
    dismissalGeneration: 0, warning: null, warningReady: null, warningGeneration: 0, tuning: 0,
    volume: { value: () => 50, release() {} } });
  radio.tuner.select(cleanStation); radio.tuner.playing = cleanStation;
  radio.ducking = new Ducking(engine); radio.tuner.setVolumeControl(radio.ducking);
  await radio.ducking.observe([{ address: "t1", status: "working" }], [], 1000);
  await radio.ducking.observe([{ address: "t1", status: "blocked" }], [], 1001);
  assert.equal(current.volume, 10, "warning/handoff tests run while ducked");
  const tasks = [];
  const cx = { notify() {}, spawn(fn) { tasks.push(fn(cx)); }, timer: { after() {} } };
  const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
  radio.command("next", cx);
  if (ending === "queued-dismissal") radio.setOpen(false, cx);
  await flush();
  assert.deepEqual(effects, [], "no browser or stop before warning layout");
  if (ending === "queued-dismissal") {
    await Promise.all(tasks);
    assert.equal(radio.warning, null); assert.equal(radio.open, false);
    assert.equal(current.source, cleanStation.url);
    continue;
  }
  const warning = find(radio.render(), "radio-warning-1");
  assert.ok(contentTexts(warning).includes("Explicit content // Explicit browser fixture"));
  if (ending === "dismissed") radio.setOpen(false, cx);
  else if (ending === "closed") await radio.close();
  else warning.calls.find(([name]) => name === "on_size_change")[1]({ width: 200, height: 16 }, cx);
  if (ending === "stop-dismissed") {
    await flush();
    assert.deepEqual(effects, ["stop"], "warning layout released the deferred stop, not the browser");
    const generation = radio.dismissalGeneration;
    radio.setOpen(false, cx);
    assert.equal(radio.dismissalGeneration, generation + 1);
    releaseStop(); await Promise.all(tasks);
    assert.deepEqual(effects, ["stop"], "dismissal while stop waits must cancel browser launch");
    assert.equal(current.source, null); assert.equal(current.status, "idle");
    assert.equal(radio.tuner.on(), false); assert.equal(radio.tuner.playing, null);
    assert.equal(radio.tuner.browserOpened, null); assert.equal(radio.tuner.error, null);
    assert.equal(radio.open, false);
    const tree = radio.render();
    assert.ok(contentTexts(find(tree, "radio-chip")).includes("OFF"));
    assert.ok(contentTexts(tree).includes("RECEIVER OFF"));
    assert.equal(find(tree, "radio-browser-opened"), undefined);
    assert.equal(find(tree, "radio-explicit"), undefined);
    continue;
  }
  await Promise.all(tasks);
  if (ending !== "shown") {
    assert.deepEqual(effects, []); assert.equal(radio.tuner.browserOpened, null);
    if (ending === "dismissed") assert.equal(current.source, cleanStation.url);
    continue;
  }
  assert.deepEqual(effects, ["stop", browser.open]);
  assert.equal(radio.tuner.on(), false); assert.equal(radio.tuner.playing, null);
  radio.setOpen(false, cx);
  entries = [cleanStation]; // handoff warning survives browser station removal
  const tree = radio.render(), chip = find(tree, "radio-chip");
  assert.ok(contentTexts(chip).includes("OFF"));
  assert.ok(contentTexts(chip).includes("EXPLICIT"));
  assert.match(chip.calls.find(([name]) => name === "tooltip")[1], /Opened in browser: Explicit browser fixture.*Explicit content/);
  assert.ok(contentTexts(tree).includes("RECEIVER OFF"));
  assert.ok(contentTexts(find(tree, "radio-browser-opened")).some(text => text.startsWith("OPENED IN BROWSER // Explicit browser fixture")));
  assert.ok(contentTexts(find(tree, "radio-power")).includes("CLEAR"));
  radio.act("power", cx); await Promise.all(tasks);
  assert.equal(radio.tuner.browserOpened, null);
  assert.equal(find(radio.render(), "radio-explicit"), undefined);
}

// Host changes rerender the owner; no timer reads live host data. Only a
// blocked edge arms a deadline, and stale deadline callbacks cannot survive close.
const owner = new Radio(), timers = new Map(), deadlines = [], ownerTasks = [];
const ownerCx = { notify() {}, timer: {
  every(ms, fn) { timers.set(ms, fn); },
  after(ms, fn) { deadlines.push({ ms, fn }); },
}, spawn(fn) { const task = fn(ownerCx); ownerTasks.push(task); } };
owner.init({}, ownerCx);
assert.deepEqual([...timers.keys()].sort(), [2000, 5000], "only station refresh/receiver heartbeat poll");
assert.equal(owner.ducking.enabled, false, "new owner restores disabled preference");
await owner.ducking.setEnabled(true);
owner.engine.started = true; owner.engine.state.source = "/fixture.wav";
let clock = Date.now(); owner.ducking.clock = () => clock;
hostTerminals = [{ address: "vps/t3", state: "live", status: "working" }];
owner.render(ownerCx); await owner.ducking.tail;
assert.equal(deadlines.length, 0, "idle host baseline requires no gain timer");
hostTerminals[0].status = "blocked";
owner.render(ownerCx); await owner.ducking.tail;
for (let i = 0; i < 8; i++) await Promise.resolve();
assert.equal(owner.engine.state.volume, 10);
const deadline = owner.ducking.until;
assert.equal(deadlines.length, 1);
owner.render(ownerCx); await owner.ducking.tail;
assert.equal(owner.ducking.until, deadline); assert.equal(deadlines.length, 1);
assert.equal(owner.open, false, "agent events never open the tuner");
clock = deadline; deadlines[0].fn(ownerCx); await owner.ducking.tail;
assert.equal(owner.engine.state.volume, 50, "deadline alone restores without another host render");
for (let i = 0; i < 8; i++) await Promise.resolve();
assert.equal(owner.ducking.nextWake(), 0);
await owner.close(); deadlines[0].fn(ownerCx);
assert.equal(owner.ducking.closed, true); assert.equal(owner.ducking.until, 0);
delete globalThis.__radioTest;
console.log("view controls, motion switch, status placement and layout keys passed");
