import { exec, appHome } from "herdr";
import { randomBytes } from "crypto";
import { parseReplies } from "./ipc.js";

export function localReceiver() {
  const token = randomBytes(16).toString("hex");
  const script = `${appHome()}/mods/cyberneon-radio/receiver.py`;
  const call = async (action, payload) => {
    const args = [script, action, token];
    if (payload !== undefined) args.push(payload);
    const result = await exec("python3", args, { timeout: 7000 }); // no `on`: always this machine
    if (result.code !== 0) throw new Error(result.stderr.trim() || "RECEIVER // IPC failed");
    return result.stdout;
  };
  return {
    available: async () => {
      try { return (await exec("mpv", ["--version"], { timeout: 3000 })).code === 0; }
      catch { return false; }
    },
    start: () => call("start"),
    request: async (payload, allowUnavailable = false) => {
      const replies = parseReplies(await call("request", payload));
      const failed = replies.find((r) => r.error !== "success" && !(allowUnavailable && r.error === "property unavailable"));
      if (failed) throw new Error(`RECEIVER // ${failed.error}`);
      return replies;
    },
    close: () => call("close"),
  };
}
