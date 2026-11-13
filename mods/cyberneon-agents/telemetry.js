// v5: usage from the Claude Code status line at the bottom of an agent's screen.
//   claudeProject/herdr-gallery │ ctx ◑ 42%
//   Opus 5.5 medium │ 5h ◔ 30% ⟳ 1h24m │ 7d ◔ 5% ⟳ 6d17h
// Codex's footer says what is LEFT, so it's turned into "used" to match:
//   GPT-6.1 Terra medium Fast · ~/projects/ledger · Context 87% left · weekly 69% left
//   (a "5h limit N% left" part appears there too, near that limit)
// Oh My Pi (omp) footer: model, context used of the window, session cost:
//    π · ◔ deepseek-v4.1-flash:cloud · 📁 ~/proj · ⑂ main ?1 · ◫ 3.4%/1M ⟲ · $0.02
// OpenCode: status line at the bottom, model on the prompt box, cost in the sidebar (wide windows only):
//   ┃  Build · Big Pickle OpenCode Zen        /path
//   /path        17.9K (9%)  ctrl+p commands    • OpenCode 1.18.13
//   $0.00 spent
// Takes the whole screen: the status lines are parsed from the last 8 lines, "$N spent" from anywhere.
// → { model, ctx, h5, h5Reset, d7, d7Reset, cost }, all as % USED; missing fields null; null if nothing parses.
// The last match wins: the status line sits at the bottom, older copies may be above it.
export function telemetry(text) {
  const out = { model: null, ctx: null, h5: null, h5Reset: null, d7: null, d7Reset: null, cost: null };
  const pct = (re, s) => { const m = s.match(re); return m ? [Number(m[1]), m[2] ?? null] : null; };
  const left = (re, s) => { const m = s.match(re); return m ? 100 - Number(m[1]) : null; };
  const all = String(text ?? "").trimEnd().split("\n");
  const opencode = all.some((l) => /•\s+OpenCode\s+\d/.test(l));
  for (const line of all.slice(-8)) {
    if (opencode) {
      const c = line.match(/\d[\d.,]*[KM]?\s+\((\d{1,3})%\)/);
      if (c && /•\s+OpenCode/.test(line)) out.ctx = Number(c[1]);
      const m = line.match(/^\s*┃\s+\S[^·]*·\s+(.+?)(?:\s{2,}|$)/u);
      if (m) out.model = m[1].trim();
      continue;
    }
    // omp: starts with "π ·". ponytail: model is the 2nd segment (default footer order); a reordered footer needs a smarter pick.
    if (/^\s*π\s+·/u.test(line)) {
      const seg = line.trim().split(" · ");
      if (seg[1]) out.model = seg[1].replace(/^[^\p{L}\p{N}]+/u, "").trim() || null;
      const c = line.match(/◫\s*([\d.]+)%/u);
      if (c) out.ctx = Math.round(Number(c[1]));
      const $ = line.match(/\$(\d[\d.,]*)/);
      if ($) out.cost = `$${$[1]}`;
      continue;
    }
    // Codex: a "% left" footer. Parsed on its own so Claude's 5h rule can't read "5h limit 80% left" as 80% used.
    if (/\d%\s+left\b/i.test(line)) {
      const c = left(/\bContext\s+(\d{1,3})%\s+left/i, line), h = left(/\b5h(?:\s+limit)?:?\s+(\d{1,3})%\s+left/i, line),
        d = left(/\b(?:weekly|7d)(?:\s+limit)?:?\s+(\d{1,3})%\s+left/i, line);
      if (c !== null) out.ctx = c;
      if (h !== null) out.h5 = h;
      if (d !== null) out.d7 = d;
      if (c !== null || h !== null || d !== null) {
        const head = line.split(" · ")[0].trim();
        if (head && !/%\s+left/i.test(head)) out.model = head;
      }
      continue;
    }
    const c = pct(/\bctx\s+\S+\s+(\d{1,3})%/u, line);
    if (c) out.ctx = c[0];
    const h = pct(/\b5h\s+\S+\s+(\d{1,3})%(?:\s*⟳\s*(\S+))?/u, line);
    if (h) {
      [out.h5, out.h5Reset] = h;
      const head = line.includes("│") ? line.split("│")[0].trim() : "";
      if (head) out.model = head;
    }
    const d = pct(/\b7d\s+\S+\s+(\d{1,3})%(?:\s*⟳\s*(\S+))?/u, line);
    if (d) [out.d7, out.d7Reset] = d;
  }
  const spent = [...all.join("\n").matchAll(/\$(\d[\d.,]*)\s+spent\b/g)].pop();
  if (spent) out.cost = `$${spent[1]}`;
  return Object.values(out).some((v) => v !== null) ? out : null;
}

// THREAT (combined): state sets the base, context pressure and a long block push it up.
//   base: idle 1, working 1, done 2, blocked 3
//   ctx:  >= 60% +1, >= 80% +2   (close to compacting / losing earlier context)
//   wait: blocked >= 5 min +1, >= 15 min +2   (someone has been waiting on you)
// Clamped to 1..5. Tone: 1 dim, 2 working, 3 done, 4-5 blocked. `why` names what raised it.
export function threat(status, ctx, blockedMs) {
  const base = { blocked: 3, done: 2, working: 1, idle: 1 }[status] ?? 1;
  const why = [];
  let up = 0;
  if (typeof ctx === "number" && ctx >= 60) { up += ctx >= 80 ? 2 : 1; why.push(`CTX ${ctx}%`); }
  if (status === "blocked" && typeof blockedMs === "number" && blockedMs >= 300_000) {
    up += blockedMs >= 900_000 ? 2 : 1; why.push(`WAIT ${Math.floor(blockedMs / 60_000)}M`);
  }
  const level = Math.max(1, Math.min(5, base + up));
  const tone = level >= 4 ? "blocked" : level === 3 ? "done" : level === 2 ? "working" : "dim";
  return { level, tone, why: why.join(" · ") };
}
