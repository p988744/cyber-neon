// Pure mpv protocol helpers. Never interpolate a source into shell/input.conf text.
export function command(action, value, requestId = 1) {
  let args;
  switch (action) {
    case "play":
      if (typeof value !== "string" || !value.trim() || /[\x00-\x1f]/.test(value)) throw new Error("Expected a URL or file path");
      args = ["loadfile", value, "replace"]; break;
    case "pause": case "mute":
      if (typeof value !== "boolean") throw new Error(`Expected ${action} boolean`);
      args = ["set_property", action, value]; break;
    case "volume":
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Expected finite volume");
      args = ["set_property", "volume", Math.max(0, Math.min(100, value))]; break;
    case "stop": args = ["stop"]; break;
    case "get": args = ["get_property", value]; break;
    default: throw new Error(`Unknown radio action: ${action}`);
  }
  return JSON.stringify({ command: args, request_id: requestId }) + "\n";
}

// An ICY update wins over the fallback file/media title. Empty metadata clears it.
export function nowPlaying(metadata, mediaTitle) {
  const text = (v) => typeof v === "string" ? v.trim() : "";
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    for (const [key, value] of Object.entries(metadata)) {
      if (key.toLowerCase() === "icy-title" && text(value)) return text(value);
    }
  }
  return text(mediaTitle);
}

export function parseReplies(output) {
  return output.split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
    .filter((message) => Number.isInteger(message.request_id));
}
