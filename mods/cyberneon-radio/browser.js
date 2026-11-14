// Browser handoff only. No network fetch, extraction, playback or receiver ownership.
export function browserURL(value) {
  if (typeof value !== "string" || /[\x00-\x20\x7f\\]/.test(value) || !/^https?:\/\//i.test(value)) {
    throw new Error("Browser station needs an absolute HTTP(S) URL");
  }
  let url;
  try { url = new URL(value); } catch { throw new Error("Invalid browser station URL"); }
  if (!url.hostname || url.username || url.password) throw new Error("Browser station URL needs a host without credentials");
  return url.href;
}

// Injected by the layout owner; argument arrays never pass through a shell.
// A successful opener acknowledges handoff, not live browser playback.
export function browserOpener({ exec, platform, script }) {
  return async value => {
    const url = browserURL(value);
    const command = platform === "macos" ? "open" : platform === "linux" ? "xdg-open" : null;
    if (!command && platform !== "windows") throw new Error("Unsupported browser handoff platform");
    const result = platform === "windows"
      ? await exec("python3", [script, url], { timeout: 5000 })
      : await exec(command, [url], { timeout: 5000 });
    if (result.code !== 0) throw new Error(result.stderr?.trim() || "Cannot open browser station");
    return url;
  };
}
