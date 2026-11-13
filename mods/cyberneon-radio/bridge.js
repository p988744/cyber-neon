import { exec, appHome } from "herdr";
import { randomBytes } from "crypto";
import { receiverClient } from "./receiver-client.js";

export function localReceiver() {
  return receiverClient({ exec, script: `${appHome()}/mods/cyberneon-radio/receiver.py`,
    newToken: () => randomBytes(16).toString("hex") }); // no `on`: always this machine
}
