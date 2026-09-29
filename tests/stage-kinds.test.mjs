import assert from "node:assert/strict";
import {
  STALE_EXCLUDED_KINDS,
  colorFor,
  compareStageRank,
  isTerminalKind
} from "../src/lib/stage-kinds.ts";

// Outcome kinds leave the pipeline; offer stays in it.
assert.equal(isTerminalKind("rejected"), true);
assert.equal(isTerminalKind("closed"), true);
assert.equal(isTerminalKind("offer"), false);
assert.equal(isTerminalKind(undefined), false);

// Only pipeline lanes can go stale.
for (const kind of ["intake", "offer", "rejected", "closed"]) {
  assert.ok(STALE_EXCLUDED_KINDS.includes(kind), `${kind} is never stale`);
}
for (const kind of ["active", "interview"]) {
  assert.ok(!STALE_EXCLUDED_KINDS.includes(kind), `${kind} can go stale`);
}

// Rank ignores board position for outcome lanes.
assert.ok(compareStageRank({ sortOrder: 0, kind: "closed" }, { sortOrder: 9, kind: "active" }) > 0);
assert.ok(compareStageRank({ sortOrder: 1, kind: "rejected" }, { sortOrder: 2, kind: "closed" }) < 0);
assert.ok(compareStageRank({ sortOrder: 3, kind: "active" }, { sortOrder: 2, kind: "offer" }) > 0);

// Colours: every rejection lane is red and interview rounds share a colour,
// pipeline lanes keep their name colours, history-only names fall back by name.
assert.equal(colorFor("Rejected at screening", "rejected"), colorFor("Rejected", "rejected"));
assert.equal(colorFor("Interview Round 2", "interview"), colorFor("Interview", "interview"));
assert.equal(colorFor("Ghosting", "closed"), "#cbd5e1");
assert.equal(colorFor("Screening", "active"), "#a78bfa");
assert.equal(colorFor("Rejected"), "#f87171");
assert.equal(colorFor("Phone call", "active", 1), "#a78bfa", "unknown pipeline lanes use the palette");

console.log("Stage kind checks passed.");
