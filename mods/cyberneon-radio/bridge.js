import { exec, appHome } from "herdr";
import * as crypto from "crypto";
import { receiverToken } from "./token.js";
import { receiverClient } from "./receiver-client.js";

export function localReceiver() {
  return receiverClient({ exec, script: `${appHome()}/mods/cyberneon-radio/receiver.py`,
    newToken: () => receiverToken(crypto) }); // no `on`: always this machine
}
