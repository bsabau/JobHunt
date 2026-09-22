import assert from "node:assert/strict";
import { buildSankeyPayload, hasCycle } from "../src/lib/sankey.ts";

// Mirror of the default pipeline. Node order comes from this list.
const stages = [
  { name: "Wishlist", sortOrder: 0 },
  { name: "Applied", sortOrder: 1 },
  { name: "Interview", sortOrder: 2 },
  { name: "Offer", sortOrder: 3 },
  { name: "Rejected", sortOrder: 4 }
];

function assertAcyclic(payload, label) {
  for (const link of payload.links) {
    assert.ok(
      link.source < link.target,
      `${label}: link ${link.source}->${link.target} is not forward-only`
    );
  }
  assert.equal(hasCycle(payload.links), false, `${label}: emitted graph contains a cycle`);
}

// N-1 regression: the two-application scenario from the re-audit. App A is
// dragged back from Applied to Wishlist while app B moves Wishlist -> Applied,
// which used to hand Recharts a two-node cycle and crash /sankey.
const twoAppCycle = buildSankeyPayload({
  stages,
  transitions: [
    { fromStatus: "Applied", toStatus: "Wishlist", company: "A" },
    { fromStatus: "Wishlist", toStatus: "Applied", company: "B" }
  ],
  entries: [
    { entryStage: "Applied", company: "A" },
    { entryStage: "Wishlist", company: "B" }
  ],
  current: [
    { stageName: "Wishlist", company: "A" },
    { stageName: "Applied", company: "B" }
  ]
});

assertAcyclic(twoAppCycle, "two-app cycle");
assert.equal(twoAppCycle.hiddenBackward, 1);
assert.equal(
  twoAppCycle.links.some((link) => link.source === 0 && link.target === 2),
  true,
  "entry link New -> Applied is kept"
);
assert.equal(
  twoAppCycle.links.some((link) => link.source === 1 && link.target === 2),
  true,
  "forward Wishlist -> Applied is kept"
);

// A pure stage-order cycle (e.g. produced by reordering stages after history
// was recorded in the old order) must also collapse to a DAG.
const reorderCycle = buildSankeyPayload({
  stages,
  transitions: [
    { fromStatus: "Interview", toStatus: "Applied", company: "C" },
    { fromStatus: "Applied", toStatus: "Interview", company: "D" }
  ],
  entries: [{ entryStage: "Wishlist", company: "C" }],
  current: [{ stageName: "Applied", company: "C" }]
});

assertAcyclic(reorderCycle, "reorder cycle");
assert.equal(reorderCycle.hiddenBackward, 1);

// No backward links means nothing is hidden.
const forwardOnly = buildSankeyPayload({
  stages,
  transitions: [
    { fromStatus: "Wishlist", toStatus: "Applied", company: "E" },
    { fromStatus: "Applied", toStatus: "Interview", company: "E" }
  ],
  entries: [{ entryStage: "Wishlist", company: "E" }],
  current: [{ stageName: "Interview", company: "E" }]
});

assertAcyclic(forwardOnly, "forward only");
assert.equal(forwardOnly.hiddenBackward, 0);

console.log("Sankey DAG checks passed.");
