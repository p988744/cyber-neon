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
