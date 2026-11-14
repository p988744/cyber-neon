// Actual panel/model/store/adapter + Python; only native UI/exec/timers are shims.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { Tuner } from "./tuner.js";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "radio-panel-add-"));
const folder = join(root, "mods/cyberneon-radio");
const manual = { name: "Manual", url: "~/Music", extra: { keep: true } };
const row = { name: "NEU RADIO", url: "https://example.invalid/live", country: "Italy", codec: "MP3", bitrate: 128, lastcheckok: 1 };
let intercept = () => null, inTask = false, starts = [];
// Chainable builder without any layout emulation.
function element() {
  const value = { items: [], calls: [], child(v) { this.items.push(v); return proxy; }, children(v) { this.items.push(...v); return proxy; }, when(test, fn) { return test ? fn(proxy) : proxy; } };
  const proxy = new Proxy(value, { get: (o, key) => key in o ? o[key] : (...args) => { o.calls.push([key, ...args]); return proxy; } });
  return proxy;
}
const host = { div: element, h_flex: element, v_flex: element,
  Input: { new: element }, InputState: { new: () => ({ on() {}, set_value() {}, value: () => "synthwave", focus() {}, release() {} }) },
  localDirectory: () => ({ search: async () => [row] }),
  appHome: () => root,
  exec: async (program, args, options) => {
    starts.push({ action: args[1], inTask });
    const injected = intercept(program, args, options);
    if (injected) return injected;
    try { return { ...await exec(program, args, options), code: 0 }; }
    catch (error) { if (typeof error.code !== "number") throw error; return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  },
};
globalThis.__addHost = host;
async function load(file, imports) {
  let source = await readFile(new URL(file, import.meta.url), "utf8");
  for (const [before, after] of imports) source = source.replace(before, after);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}
const absolute = name => JSON.stringify(new URL(name, import.meta.url).href);
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve)); };
const all = node => node && typeof node === "object" ? [node, ...node.items.flatMap(all)] : [];
const texts = panel => all(panel.render({})).flatMap(n => n.items).filter(v => typeof v === "string");
function context() {
  const tasks = [], timers = new Set(); let notifications = 0;
  const cx = { notify() { notifications++; }, spawn(fn) {
    inTask = true;
    try { tasks.push(Promise.resolve(fn(cx))); } finally { inTask = false; }
  }, timer: { after(ms, fn) { const timer = { ms, fn, cancel() { timers.delete(timer); } }; timers.add(timer); return timer; } } };
  return { cx, tasks, timers, get notifications() { return notifications; },
    async expire() { for (const timer of [...timers]) { timers.delete(timer); timer.fn(cx); } await flush(); } };
}
try {
  await mkdir(folder, { recursive: true });
  await copyFile(new URL("station-files.py", import.meta.url), join(folder, "station-files.py"));
  const { localStations } = await load("station-storage.js", [
    ['import { exec, appHome } from "herdr";', 'const { exec, appHome } = globalThis.__addHost;'], ['"./stations.js"', absolute("stations.js")],
  ]);
  const { DirectoryPanel } = await load("search-ui.js", [
    ['import { div } from "gpui-kit";', 'const { div, h_flex, v_flex, Input, InputState, localDirectory } = globalThis.__addHost;'],
    ['import { h_flex, v_flex, Input, InputState } from "gpui-base";', ''],
    ['"./search.js"', absolute("search.js")], ['import { localDirectory } from "./search-client.js";', ''],
  ]);
  function click(panel, id, cx) {
    const node = all(panel.render({})).find(n => n.calls.some(([key, value]) => key === "id" && value === id));
    assert.ok(node, id);
    const handler = node.calls.find(([key]) => key === "on_click");
    assert.ok(handler, `${id} enabled`); handler[1]({}, cx);
  }
  async function fixture() {
    intercept = () => null; starts = [];
    await writeFile(join(root, "radio.json"), JSON.stringify([manual]));
    const store = localStations(); await store.refresh();
    const panel = new DirectoryPanel(store); panel.expanded = true;
    const engine = { snapshot: () => ({ status: "playing", source: manual.url }), play() { assert.fail("Add must not play"); } };
    const tuner = new Tuner(engine, store); tuner.select(store.snapshot().stations[0]);
    tuner.playing = tuner.station();
    const selected = tuner.selected, playing = tuner.playing;
    const unchanged = () => { assert.equal(tuner.selected, selected); assert.equal(tuner.playing, playing); assert.equal(engine.snapshot().source, manual.url); };
    store.adapter.resolve = () => assert.fail("Add must not prepare a source");
    const ctx = context(); click(panel, "radio-tag-synthwave", ctx.cx); await Promise.all(ctx.tasks);
    return { store, panel, ctx, unchanged };
  }
  // A pre-existing refresh can remain pending forever (injected host boundary).
  // It must not strand Add after the actual Python save has completed.
  for (const staleError of [false, true]) {
    const { store, panel, ctx, unchanged } = await fixture();
    let release;
    intercept = (_p, args) => args[1] === "read" ? new Promise(resolve => { release = resolve; }) : null;
    const old = store.refresh(); await flush();
    assert.equal(store.refresh(), old, "ordinary refresh callers still coalesce");
    intercept = () => null;
    const notifications = ctx.notifications;
    click(panel, "radio-add-0", ctx.cx);
    panel.add(panel.model.snapshot().results[0], ctx.cx);
    assert.ok(texts(panel).includes("SAVING…"));
    // Wait for actual Python persistence without awaiting the hung owner task.
    for (let i = 0; i < 100 && JSON.parse(await readFile(join(root, "radio.json"), "utf8")).length < 2; i++) await new Promise(r => setTimeout(r, 10));
    for (let i = 0; i < 100 && !texts(panel).includes("SAVED"); i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(texts(panel).includes("SAVED"), "persisted Add must reach rendered SAVED despite an older pending refresh");
    assert.equal(panel.model.snapshot().saving, null);
    unchanged();
    assert.equal(starts.find(s => s.action === "save").inTask, true, "save starts inside the owner task");
    assert.equal(starts.filter(s => s.action === "save").length, 1, "pending Adds coalesce");
    assert.ok(ctx.notifications >= notifications + 2, "owner redraws both pending and completion");
    await old; // Owner/coalesced refresh tasks must resume before the old helper.
    release(staleError ? { code: 1, stdout: "", stderr: "obsolete read failed" } : { code: 0, stdout: JSON.stringify(JSON.stringify([manual])), stderr: "" }); await flush();
    assert.equal(store.snapshot().error, null, "late obsolete read errors cannot replace success");
    assert.ok(texts(panel).includes("SAVED"), "late stale read cannot remove the saved station");
    assert.deepEqual(JSON.parse(await readFile(join(root, "radio.json"), "utf8"))[0], manual);
    assert.equal(ctx.timers.size, 0);
  }
  // Save/read/start errors and never-settling adapter calls leave a visible retry.
  for (const failure of ["save error", "read error", "read missing", "missing helper", "start failure", "save hangs", "read hangs"]) {
    const { panel, ctx } = await fixture();
    intercept = (_p, args) => {
      if (failure === "start failure" && args[1] === "save") return Promise.reject(new Error("python3 not found"));
      if (failure === "read missing" && args[1] === "read") return Promise.resolve({ code: 0, stdout: JSON.stringify("[]"), stderr: "" });
      if (failure.startsWith(args[1])) return failure.endsWith("hangs") ? new Promise(() => {}) : Promise.resolve({ code: 1, stdout: "", stderr: `${failure}; retry Add` });
      return null;
    };
    if (failure === "missing helper") await rm(join(folder, "station-files.py"));
    click(panel, "radio-add-0", ctx.cx); await flush();
    if (failure === "missing helper") {
      for (let i = 0; i < 100 && !panel.model.snapshot().error; i++) await new Promise(r => setTimeout(r, 10));
    }
    if (failure.startsWith("read")) {
      // Let the real Python save finish before expiring the read deadline.
      for (let i = 0; i < 100 && starts.filter(s => s.action === "read").length < 2; i++) await new Promise(r => setTimeout(r, 10));
      await flush();
    }
    await ctx.expire();
    assert.ok(!texts(panel).includes("SAVING…"), `${failure} must terminate rendered Saving`);
    assert.ok(panel.model.snapshot().error, `${failure} must show an error`);
    assert.ok(texts(panel).includes(panel.model.snapshot().error), `${failure} error must be rendered`);
    assert.equal(panel.model.snapshot().message, null, "failed refresh must never claim success");
    await copyFile(new URL("station-files.py", import.meta.url), join(folder, "station-files.py"));
    intercept = () => null; click(panel, "radio-add-0", ctx.cx); await Promise.all(ctx.tasks);
    assert.ok(texts(panel).includes("SAVED"), `${failure} retry must render SAVED`);
    assert.equal(JSON.parse(await readFile(join(root, "radio.json"), "utf8")).length, 2);
    assert.equal(ctx.timers.size, 0);
  }
  // Closing cancels owner deadlines and ignores late helper completion.
  for (const stage of ["save", "read"]) {
    const { panel, ctx } = await fixture(); let release;
    intercept = (_p, args) => args[1] === stage ? new Promise(resolve => { release = resolve; }) : null;
    click(panel, "radio-add-0", ctx.cx);
    for (let i = 0; i < 100 && !release; i++) await new Promise(r => setTimeout(r, 10));
    assert.ok(release); panel.close();
    const notifications = ctx.notifications;
    await Promise.all(ctx.tasks);
    release({ code: 0, stdout: stage === "read" ? JSON.stringify(JSON.stringify([manual])) : "true", stderr: "" });
    await flush();
    assert.equal(ctx.notifications, notifications, "closed owner must never redraw");
    assert.equal(panel.model.snapshot().message, null);
    assert.equal(ctx.timers.size, 0);
  }
  // Actual POSIX lock contention: the production 5s exec timeout kills only
  // this scratch helper; error is visible and the same panel can retry.
  {
    const { panel, ctx, unchanged } = await fixture();
    const holder = spawn("python3", ["-u", "-c", 'import fcntl,sys,time; f=open(sys.argv[1], "a"); fcntl.flock(f, fcntl.LOCK_EX); print("locked", flush=True); time.sleep(30)', join(root, "radio.json.lock")]);
    try {
      const [ready] = await once(holder.stdout, "data"); assert.match(ready.toString(), /locked/);
      click(panel, "radio-add-0", ctx.cx); await Promise.all(ctx.tasks);
      assert.ok(!texts(panel).includes("SAVING…"));
      assert.ok(texts(panel).includes(panel.model.snapshot().error));
      assert.deepEqual(JSON.parse(await readFile(join(root, "radio.json"), "utf8")), [manual]);
      unchanged();
    } finally { const exited = once(holder, "exit"); holder.kill(); await exited; }
    click(panel, "radio-add-0", ctx.cx); await Promise.all(ctx.tasks);
    assert.ok(texts(panel).includes("SAVED")); unchanged();
  }
  console.log("add.check ok (actual panel -> model -> store -> adapter/Python; rendered SAVED, stale refresh, errors, deadlines, retry)");
} finally { delete globalThis.__addHost; await rm(root, { recursive: true, force: true }); }
