// node mods/cyberneon-jobs/rules.check.mjs
import assert from "node:assert/strict";
import { tasks, prObjectives, prRisk, issueRisk, milestoneRisk, plain } from "./rules.js";

const now = Date.parse("2026-11-13T00:00:00Z");
const pr = (checks, rd, isDraft = false) => {
  const p = { statusCheckRollup: checks.map((c) => ({ name: c, conclusion: c })), reviewDecision: rd, isDraft, body: "- [ ] a\n- [x] b" };
  return { ...p, objectives: prObjectives(p) };
};
assert.equal(prRisk(pr(["FAILURE"], "CHANGES_REQUESTED")), "VERY HIGH");
assert.equal(prRisk(pr(["FAILURE"], null)), "HIGH");
assert.equal(prRisk(pr(["SUCCESS"], "CHANGES_REQUESTED", true)), "HIGH");
assert.equal(prRisk(pr(["SUCCESS"], null, true)), "LOW");
assert.equal(prRisk(pr(["SKIPPED"], "APPROVED")), "MODERATE");
assert.deepEqual(tasks("- [ ] a\n- [x] b").map((t) => t.state), ["open", "done"]);

assert.equal(issueRisk({ labels: ["P0-blocker"] }, now), "VERY HIGH");
assert.equal(issueRisk({ labels: ["bug"] }, now), "HIGH");
assert.equal(issueRisk({ labels: [], createdAt: "2026-09-01T00:00:00Z" }, now), "MODERATE");
assert.equal(issueRisk({ labels: [], createdAt: "2026-11-01T00:00:00Z" }, now), "LOW");

assert.equal(milestoneRisk({ due_on: "2026-11-15T00:00:00Z", open_issues: 2 }, now), "VERY HIGH");
assert.equal(milestoneRisk({ due_on: "2026-11-01T00:00:00Z", open_issues: 2 }, now), "VERY HIGH");
assert.equal(milestoneRisk({ due_on: "2026-11-19T00:00:00Z", open_issues: 2 }, now), "HIGH");
assert.equal(milestoneRisk({ due_on: "2026-11-15T00:00:00Z", open_issues: 0 }, now), "MODERATE");
assert.equal(milestoneRisk({ due_on: null, open_issues: 3 }, now), "MODERATE");

assert.equal(plain("## Title\n\nSee [docs](http://x) and **bold** `code`.\n- item\n- [ ] task\n<!-- hide -->"),
  "Title\n\nSee docs and bold code.\n• item\n□ task");
console.log("rules ok");

// milestone card facts
import { msInfo } from "./rules.js";
const NOW = Date.parse("2026-11-13T06:00:00Z");
assert.deepEqual(msInfo({ open_issues: 6, closed_issues: 2, due_on: "2026-11-20T08:00:00Z" }, NOW),
  { done: 2, total: 8, pct: 25, due: "DUE 2026-11-20 · 7D LEFT", hot: false });
assert.equal(msInfo({ open_issues: 1, closed_issues: 0, due_on: "2026-11-10T00:00:00Z" }, NOW).due, "DUE 2026-11-10 · OVERDUE 3D");
assert.equal(msInfo({ open_issues: 1, closed_issues: 0, due_on: "2026-11-10T00:00:00Z" }, NOW).hot, true);
assert.deepEqual(msInfo({ open_issues: 0, closed_issues: 0, due_on: null }, NOW), { done: 0, total: 0, pct: 0, due: "NO DUE DATE", hot: false });
console.log("msInfo ok");
