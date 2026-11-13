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

// issue <-> branch
import { issueBranch, branchIssue } from "./rules.js";
assert.equal(issueBranch(4, "Jobs: find or deploy the agent for an issue"), "issue-4-jobs-find-or-deploy-the-agent-for-an-iss");
assert.equal(issueBranch(333, "Mod：靜態資料和 secret 的儲存"), "issue-333-mod-secret");
assert.equal(issueBranch(7, "儲存"), "issue-7");
assert.equal(branchIssue("issue-4-jobs-find"), 4);
assert.equal(branchIssue("issue-12"), 12);
assert.equal(branchIssue("feat/issue-9-x"), 9);
assert.equal(branchIssue("333-mod-secret"), 333);
assert.equal(branchIssue("main"), null);
assert.equal(branchIssue("v0.2-polish"), null);
assert.equal(branchIssue(null), null);
console.log("issue branch ok");

// milestone branches
import { milestoneBranch, branchMilestone } from "./rules.js";
assert.equal(milestoneBranch(1, "v0.3 Polish"), "milestone-1-v0-3-polish");
assert.equal(branchMilestone("milestone-1-v0-3-polish"), 1);
assert.equal(branchMilestone("milestone-12"), 12);
assert.equal(branchMilestone("issue-1-x"), null);
assert.equal(branchIssue("milestone-1-v0-3-polish"), null);
console.log("milestone branch ok");

// open PRs per issue
import { issuePRs } from "./rules.js";
const pm = issuePRs([{ number: 12, headRefName: "issue-4-docs" }, { number: 9, headRefName: "issue-4-old", isDraft: true }, { number: 13, headRefName: "main" }, { number: 14, headRefName: "7-fix" }]);
assert.deepEqual(pm.get(4), { number: 9, draft: true });
assert.deepEqual(pm.get(7), { number: 14, draft: false });
assert.equal(pm.size, 2);
console.log("issuePRs ok");

// yolo flags
import { yoloArgv } from "./rules.js";
assert.deepEqual(yoloArgv(["claude"]), ["claude", "--dangerously-skip-permissions"]);
assert.deepEqual(yoloArgv(["codex", "--no-daemon"]), ["codex", "--no-daemon", "--dangerously-bypass-approvals-and-sandbox"]);
assert.deepEqual(yoloArgv(["/opt/bin/omp"]), ["/opt/bin/omp", "--auto-approve"]);
assert.deepEqual(yoloArgv(["claude", "--dangerously-skip-permissions"]), ["claude", "--dangerously-skip-permissions"]);
assert.equal(yoloArgv(["pi"]), null);
assert.equal(yoloArgv(undefined), null);
console.log("yolo ok");
