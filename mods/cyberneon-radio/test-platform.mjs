// Test harness only. Mirrors the receiver's platform-specific scratch location.
import { tmpdir } from "node:os";
import { join } from "node:path";
export const sessionRoot = token => join(process.platform === "win32" ? tmpdir() : "/tmp", `cnr-${token}`);
