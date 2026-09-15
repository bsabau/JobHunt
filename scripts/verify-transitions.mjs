import assert from "node:assert/strict";
import { rewindTransitionPath } from "../src/lib/transitions.ts";

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

console.log("Transition rewind checks passed.");
