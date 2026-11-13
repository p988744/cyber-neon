import { exec, appHome } from "herdr";
import { StationStore } from "./stations.js";

// Local config only: never use the active space's folder or remote machine.
export function localStations() {
  const root = appHome();
  const path = `${root}/radio.json`;
  async function call(action, value) {
    const result = await exec("python3", [`${root}/mods/cyberneon-radio/station-files.py`, action, root, ...(value === undefined ? [] : [value])], { timeout: 5000 });
    if (result.code !== 0) throw new Error(result.stderr?.trim() || "Cannot read radio sources");
    return JSON.parse(result.stdout);
  }
  return new StationStore({ path, read: () => call("read"), resolve: (url) => call("resolve", url) });
}
