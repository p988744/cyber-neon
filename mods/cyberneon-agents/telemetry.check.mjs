// node mods/cyberneon-agents/telemetry.check.mjs
import assert from "node:assert/strict";
import { telemetry } from "./telemetry.js";

const sample = `some output
  claudeProject/herdr-gallery │ ctx ◑ 42%
  Opus 5.5 medium │ 5h ◔ 30% ⟳ 1h24m │ 7d ◔ 5% ⟳ 6d17h
  ⏵⏵ bypass permissions on`;
assert.deepEqual(telemetry(sample), { model: "Opus 5.5 medium", ctx: 42, h5: 30, h5Reset: "1h24m", d7: 5, d7Reset: "6d17h" });

assert.deepEqual(telemetry("x │ ctx ● 91%\nSonnet 5.5 │ 5h ◕ 77% ⟳ 12m"),
  { model: "Sonnet 5.5", ctx: 91, h5: 77, h5Reset: "12m", d7: null, d7Reset: null });

assert.equal(telemetry("$ ls\nfoo bar 5h\n%%% ⟳"), null);
assert.equal(telemetry(""), null);
assert.equal(telemetry(undefined), null);
console.log("telemetry ok");

// THREAT (combined)
import { threat } from "./telemetry.js";
const lv = (...a) => threat(...a).level;
assert.equal(lv("idle", null, null), 1);
assert.equal(lv("working", 42, null), 1);
assert.equal(lv("working", 65, null), 2);
assert.equal(lv("working", 85, null), 3);
assert.equal(lv("done", null, null), 2);
assert.equal(lv("blocked", null, 60_000), 3);
assert.equal(lv("blocked", null, 6 * 60_000), 4);
assert.equal(lv("blocked", 90, 20 * 60_000), 5); // clamped
assert.equal(lv("idle", null, 20 * 60_000), 1); // waiting only counts when blocked
assert.equal(threat("blocked", 82, 12 * 60_000).why, "CTX 82% · WAIT 12M");
assert.equal(threat("blocked", null, 0).tone, "done");
assert.equal(threat("working", 85, null).tone, "done");
assert.equal(threat("blocked", 70, 6 * 60_000).tone, "blocked");
console.log("threat ok");

// Codex footer (real Codex footer shape), "% left" turned into % used
const cx = telemetry(`› Ask Codex to do anything
  GPT-6.1 Terra medium Fast · ~/projects/ledger · Context 87% left · weekly 69% left
  ← for agents · ? for shortcuts`);
assert.equal(cx.model, "GPT-6.1 Terra medium Fast");
assert.equal(cx.ctx, 13);
assert.equal(cx.d7, 31);
assert.equal(cx.h5, null);
const cx5 = telemetry("  GPT-6.1 Terra medium Fast · ~/notes-app · Context 36% left · 5h limit 20% left · weekly 69% left");
assert.equal(cx5.ctx, 64);
assert.equal(cx5.h5, 80);
assert.equal(cx5.d7, 31);
console.log("codex ok");
