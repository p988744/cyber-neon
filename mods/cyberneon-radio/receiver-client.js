import { parseReplies } from "./ipc.js";

// Only definite receiver loss permits a new generation. mpv command failures
// and transient helper errors must not replace a healthy player.
export class ReceiverGone extends Error {}

export function receiverClient({ exec, script, newToken }) {
  let token = null;
  let closed = false;
  const call = async (action, session, payload) => {
    const args = [script, action, session];
    if (payload !== undefined) args.push(payload);
    const result = await exec("python3", args, { timeout: 7000 });
    if (result.code !== 0) {
      const ErrorType = result.code === 3 ? ReceiverGone : Error;
      throw new ErrorType(result.stderr.trim() || "RECEIVER // IPC failed");
    }
    return result.stdout;
  };
  return {
    available: async () => {
      try { return (await exec("mpv", ["--version"], { timeout: 3000 })).code === 0; }
      catch { return false; }
    },
    start: async () => {
      if (closed) throw new Error("Receiver owner closed");
      // Cancel the old generation before replacing it, including a failed start.
      // close() can run during this await; never allocate a token after it wins.
      if (token !== null) await call("close", token);
      if (closed) throw new Error("Receiver owner closed");
      token = newToken();
      await call("start", token); // token is published before any suspension
    },
    request: async (payload, allowUnavailable = false) => {
      if (closed) throw new Error("Receiver owner closed");
      if (token === null) throw new ReceiverGone("Receiver not started");
      const replies = parseReplies(await call("request", token, payload));
      const failed = replies.find((r) => r.error !== "success" && !(allowUnavailable && r.error === "property unavailable"));
      if (failed) throw new Error(`RECEIVER // ${failed.error}`);
      return replies;
    },
    close: async () => {
      closed = true; // final across all generations, even an in-flight retirement
      if (token !== null) await call("close", token);
    },
  };
}
