// Pure rules (no host calls), so `node rules.check.mjs` can test them.
const DAY = 86_400_000;

// `- [ ]` / `- [x]` lines of a PR or issue body.
export const tasks = (body) => [...(body ?? "").matchAll(/^\s*[-*] \[([ xX])\] (.+)$/gm)]
  .map((m) => ({ key: `task:${m[2].trim()}`, text: m[2].trim(), state: m[1] === " " ? "open" : "done" }));

// CI: SUCCESS done; SKIPPED/NEUTRAL count as done too (they never turn green). Failures → blocked.
const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
export function prObjectives(pr) {
  const out = [];
  for (const c of pr.statusCheckRollup ?? []) {
    const name = c.name ?? c.context ?? "check";
    const end = c.conclusion || c.state || "";
    out.push({ key: `ci:${name}`, text: name, state: ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(end) ? "done" : FAILED.has(end) ? "blocked" : "open" });
  }
  const rd = pr.reviewDecision;
  out.push({ key: "review", text: "REVIEW", state: rd === "APPROVED" ? "done" : rd === "CHANGES_REQUESTED" ? "blocked" : "open" });
  return out.concat(tasks(pr.body));
}

// Risk levels (documented in NOTES "## v5 journal").
export function prRisk(pr) {
  const failed = pr.objectives.some((o) => o.key.startsWith("ci:") && o.state === "blocked");
  const changes = pr.reviewDecision === "CHANGES_REQUESTED";
  if (failed && changes) return "VERY HIGH";
  if (failed || changes) return "HIGH";
  return pr.isDraft ? "LOW" : "MODERATE";
}
export function issueRisk(issue, now = Date.now()) {
  const labels = (issue.labels ?? []).join(" ").toLowerCase();
  if (/critical|urgent|p0/.test(labels)) return "VERY HIGH";
  if (/bug|p1|priority/.test(labels)) return "HIGH";
  if (issue.createdAt && now - Date.parse(issue.createdAt) > 30 * DAY) return "MODERATE";
  return "LOW";
}
export function milestoneRisk(ms, now = Date.now()) {
  if (!ms.due_on || !ms.open_issues) return "MODERATE";
  const left = Date.parse(ms.due_on) - now; // overdue counts as "within"
  return left <= 3 * DAY ? "VERY HIGH" : left <= 7 * DAY ? "HIGH" : "MODERATE";
}

// Milestone card facts: progress from GitHub's own counts (not the 50-issue list), due text, how urgent.
export function msInfo(ms, now = Date.now()) {
  const done = ms.closed_issues ?? 0, total = done + (ms.open_issues ?? 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (!ms.due_on) return { done, total, pct, due: "NO DUE DATE", hot: false };
  const days = Math.trunc((Date.parse(ms.due_on) - now) / DAY); // whole days; under a day either way reads TODAY
  const date = ms.due_on.slice(0, 10);
  const due = days < 0 ? `DUE ${date} · OVERDUE ${-days}D` : days === 0 ? `DUE ${date} · TODAY` : `DUE ${date} · ${days}D LEFT`;
  return { done, total, pct, due, hot: days <= 3 && ms.open_issues > 0 };
}

// Markdown → plain lines. ponytail: regex strip, not a parser; nested/odd markdown may leave stray marks.
export const plain = (md) => (md ?? "").replace(/\r/g, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/```[^\n]*\n?/g, "")
  .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
  .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  .replace(/<[^>\n]+>/g, "")
  .replace(/^\s{0,3}(#{1,6}|>+)\s?/gm, "")
  .replace(/^\s*[-*+] \[[ xX]\]\s*/gm, "□ ")
  .replace(/^\s*[-*+]\s+/gm, "• ")
  .replace(/^\s*([-*_])\1{2,}\s*$/gm, "")
  .replace(/(\*\*|__|\*|_|`|~~)(\S(?:.*?\S)?)\1/g, "$2")
  .replace(/\n{3,}/g, "\n\n")
  .trim();
