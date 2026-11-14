// Test harness only. Mirrors the receiver's platform-specific scratch location.
import { tmpdir } from "node:os";
import { join } from "node:path";
export const sessionRoot = token => join(process.platform === "win32" ? tmpdir() : "/tmp", `cnr-${token}`);

// CI runners have no audio device. Select mpv's real null audio output through
// actual IPC before loading generated media; leave production launch unchanged.
export function silentReceiver(bridge) {
  const start = bridge.start;
  bridge.start = async () => {
    await start();
    await bridge.request(JSON.stringify({ command: ["set_property", "options/ao", "null"], request_id: 1 }) + "\n");
  };
  return bridge;
}
