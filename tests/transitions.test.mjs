import assert from "node:assert/strict";
import { rewindTransitionPath } from "../src/lib/transitions.ts";
import { compareStageRank, withPipelineRank } from "../src/lib/stage-kinds.ts";

const stages = [
  { name: "Wishlist", sortOrder: 0 },
  { name: "Applied", sortOrder: 1 },
  { name: "Interview", sortOrder: 2 },
  { name: "Offer", sortOrder: 3 },
  { name: "Rejected", sortOrder: 4 }
];

function transition(id, fromStatus, toStatus, transitionedAt) {
  return { id, fromStatus, toStatus, transitionedAt };
}

function shape(result) {
  return result.map((t) => `${t.fromStatus}->${t.toStatus}`);
}

// Applied -> Offer then rewind to Interview: entry stays Applied and the
// reconnect edge is Applied -> Interview.
assert.deepEqual(
  shape(rewindTransitionPath(
    [transition(2, "Applied", "Offer", "2026-09-04T00:00:00Z")],
    { name: "Interview", sortOrder: 2 },
    "Offer",
    stages
  )),
  ["Applied->Interview"]
);

// Applied -> Interview -> Offer then rewind to Interview: keep the original
// edge into Interview untouched (N-2), so its earliest timestamp survives.
const revisits = [
  transition(1, "Applied", "Interview", "2026-09-03T00:00:00Z"),
  transition(2, "Interview", "Offer", "2026-09-08T00:00:00Z")
];
const revisitResult = rewindTransitionPath(
  revisits,
  { name: "Interview", sortOrder: 2 },
  "Offer",
  stages
);
assert.deepEqual(shape(revisitResult), ["Applied->Interview"]);
assert.equal(revisitResult[0].id, 1, "the first visit keeps its own row");
assert.equal(revisitResult[0].transitionedAt, "2026-09-03T00:00:00Z", "first visit timestamp is preserved");

// Moving back to the entry stage leaves no transitions.
assert.deepEqual(
  shape(rewindTransitionPath(
    [transition(1, "Applied", "Interview", "2026-09-03T00:00:00Z")],
    { name: "Applied", sortOrder: 1 },
    "Interview",
    stages
  )),
  []
);

// Moving before the entry stage clears the history (N-3).
assert.deepEqual(
  shape(rewindTransitionPath(
    [transition(1, "Applied", "Offer", "2026-09-03T00:00:00Z")],
    { name: "Wishlist", sortOrder: 0 },
    "Offer",
    stages
  )),
  []
);

// A forward skip (not a rewind) is left unchanged.
assert.deepEqual(
  shape(rewindTransitionPath(
    [transition(1, "Applied", "Offer", "2026-09-03T00:00:00Z")],
    { name: "Offer", sortOrder: 3 },
    "Applied",
    stages
  )),
  ["Applied->Offer"]
);

// A no-op move (target already current) leaves the history unchanged.
assert.deepEqual(
  shape(rewindTransitionPath(
    [transition(1, "Applied", "Interview", "2026-09-03T00:00:00Z")],
    { name: "Interview", sortOrder: 2 },
    "Interview",
    stages
  )),
  ["Applied->Interview"]
);

// Board order with an outcome lane placed before Screening. Pipeline rank moves
// every outcome lane after the pipeline, so its board position is irrelevant.
const board = [
  { name: "Applied", sortOrder: 0, kind: "active" },
  { name: "Rejected at screening", sortOrder: 1, kind: "rejected" },
  { name: "Screening", sortOrder: 2, kind: "active" },
  { name: "Interview", sortOrder: 3, kind: "interview" },
  { name: "Ghosting", sortOrder: 4, kind: "closed" },
  { name: "Offer", sortOrder: 5, kind: "offer" }
];
const ranked = withPipelineRank(board);
const rankOf = (name) => ranked.find((stage) => stage.name === name);

assert.deepEqual(
  ranked.map((stage) => stage.name),
  ["Applied", "Screening", "Interview", "Offer", "Rejected at screening", "Ghosting"],
  "outcome lanes rank after the pipeline, keeping their relative order"
);

// Screening -> Rejected at screening is forward, although the lane sits earlier
// on the board: stageMoveStatement only rewinds when the target ranks lower.
assert.ok(
  compareStageRank(board[1], board[2]) > 0,
  "a terminal lane outranks every pipeline lane"
);
assert.ok(compareStageRank(board[5], board[1]) < 0, "Offer stays in the pipeline group");

// Undoing that rejection (back to Screening) keeps the Screening visit and
// drops only the rejection edge.
assert.deepEqual(
  shape(rewindTransitionPath(
    [
      transition(1, "Applied", "Screening", "2026-09-03T00:00:00Z"),
      transition(2, "Screening", "Rejected at screening", "2026-09-10T00:00:00Z")
    ],
    rankOf("Screening"),
    "Rejected at screening",
    ranked
  )),
  ["Applied->Screening"]
);

// Undoing a CV-screen rejection back to Applied (the entry stage) clears it.
assert.deepEqual(
  shape(rewindTransitionPath(
    [transition(1, "Applied", "Rejected at screening", "2026-09-03T00:00:00Z")],
    rankOf("Applied"),
    "Rejected at screening",
    ranked
  )),
  []
);

console.log("Transition rewind checks passed.");
