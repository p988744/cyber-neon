import assert from "node:assert/strict";
import { browserURL, browserOpener } from "./browser.js";

for (const value of [null, "", "javascript:alert(1)", "file:///tmp/test", "mailto:x@example.invalid", "//example.invalid", "https://", "https://?x", "https://example.invalid\n", "https://example.invalid/a b", "https://user:password@example.invalid", "https://example.invalid\\x", "--help"]) {
  assert.throws(() => browserURL(value));
}
const calls = [];
const exec = async (...args) => { calls.push(args); return { code: 0 }; };
const url = "https://example.invalid/watch?x=%24%28test%29&v=abc#playlist";
for (const platform of ["macos", "linux"]) {
  const open = browserOpener({ exec, platform });
  assert.equal(await open(url), url);
  assert.deepEqual(calls.at(-1), [platform === "macos" ? "open" : "xdg-open", [url], { timeout: 5000 }]);
  const before = calls.length;
  await assert.rejects(open("file:///tmp/no"));
  assert.equal(calls.length, before);
}
assert.equal(browserURL("HTTPS://EXAMPLE.invalid"), "https://example.invalid/");
await assert.rejects(browserOpener({ exec, platform: "windows" })(url), /macOS and Linux/);
await assert.rejects(browserOpener({ exec: async () => ({ code: 1, stderr: "no browser" }), platform: "linux" })(url), /no browser/);
await assert.rejects(browserOpener({ exec: async () => ({ code: 1 }), platform: "macos" })(url), /Cannot open/);
await assert.rejects(browserOpener({ exec: async () => { throw new Error("timeout"); }, platform: "macos" })(url), /timeout/);
console.log("browser.check ok (HTTP(S), safe argument handoff, platforms, opener failures; no browser launched)");
