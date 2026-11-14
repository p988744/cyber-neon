import { exec, window, appHome } from "herdr";
import { browserOpener } from "./browser.js";

export function localBrowser() {
  return browserOpener({ exec, platform: window()?.platform, script: `${appHome()}/mods/cyberneon-radio/browser-open.py` });
}
