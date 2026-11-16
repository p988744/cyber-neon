#!/usr/bin/env node
// Claude Code status line that cyberneon-agents can read (see telemetry.js):
//   Opus 5.5 │ ctx ◑ 42% │ 5h ◔ 30% ⟳ 1h24m │ 7d ◔ 5% ⟳ 6d17h
// Claude Code pipes a JSON blob to stdin; fields that are missing are simply left out.
// Setup: add to ~/.claude/settings.json
//   "statusLine": { "type": "command", "command": "node /path/to/claude-statusline.mjs" }
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => process.stdout.write(render(parse(raw)) + "\n"));

function parse(s) { try { return JSON.parse(s) ?? {}; } catch { return {}; } }
const pct = (v) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null);
const dial = (p) => (p >= 75 ? "●" : p >= 50 ? "◕" : p >= 25 ? "◑" : p > 0 ? "◔" : "○");
function left(at, now = Date.now()) {
  const ms = (typeof at === "number" ? (at < 1e12 ? at * 1000 : at) : Date.parse(at)) - now;
  if (!isFinite(ms) || ms <= 0) return null;
  const m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d}d${h}h` : h ? `${h}h${m % 60}m` : `${m}m`;
}
function part(label, limit) {
  const p = pct(limit?.used_percentage);
  if (p === null) return null;
  const r = left(limit.resets_at);
  return `${label} ${dial(p)} ${p}%${r ? ` ⟳ ${r}` : ""}`;
}
export function render(j) {
  const model = j.model?.display_name || j.model?.id || "Claude";
  const ctx = pct(j.context_window?.used_percentage);
  return [
    model,
    ctx === null ? null : `ctx ${dial(ctx)} ${ctx}%`,
    part("5h", j.rate_limits?.five_hour),
    part("7d", j.rate_limits?.seven_day),
  ].filter(Boolean).join(" │ ");
}
