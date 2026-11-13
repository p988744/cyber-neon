import { exec, appHome } from "herdr";

export function localDirectory() {
  const root = appHome();
  return {
    async search(tag) {
      const result = await exec("python3", [`${root}/mods/cyberneon-radio/radio-browser.py`, tag], { timeout: 18000 });
      if (result.code !== 0) throw new Error(result.stderr?.trim() || "Radio Browser search failed; retry Search");
      return JSON.parse(result.stdout);
    },
  };
}
