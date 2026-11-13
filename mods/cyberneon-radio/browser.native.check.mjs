// Isolated native module/runtime check; never touches the user's app or opens a browser.
import { execFileSync } from "node:child_process";
import { mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "radio-browser-native-"));
try {
  for (const file of ["browser.js", "browser-host.js"]) {
    await copyFile(new URL(file, import.meta.url), join(root, file));
  }
  await writeFile(join(root, "main.js"), `
import { View, div } from "gpui-kit";
import { browserURL } from "./browser.js";
import { localBrowser } from "./browser-host.js";
export default class BrowserCheck extends View {
  render() {
    if (browserURL("HTTPS://EXAMPLE.invalid") !== "https://example.invalid/") throw new Error("Native URL normalization failed");
    let rejected = false;
    try { browserURL("file:///tmp/no"); } catch { rejected = true; }
    if (!rejected || typeof localBrowser() !== "function") throw new Error("Browser adapter contract failed");
    return div().child("Browser adapter checked without launching");
  }
}
`);
  execFileSync("herdr-app", ["check", root], { stdio: "inherit", timeout: 15000 });
} finally { await rm(root, { recursive: true, force: true }); }
