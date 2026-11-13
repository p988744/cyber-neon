import { exec, window } from "herdr";
import { browserOpener } from "./browser.js";

export function localBrowser() {
  return browserOpener({ exec, platform: window()?.platform });
}
