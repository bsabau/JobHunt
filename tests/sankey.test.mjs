import assert from "node:assert/strict";
import { buildSankeyPayload, hasCycle } from "../src/lib/sankey.ts";
import { withPipelineRank } from "../src/lib/stage-kinds.ts";

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

// An outcome lane placed before Screening on the board. With pipeline ranks the
// Screening -> "Rejected at screening" link points forward and is kept, and
// nodes carry their kind (absent for the entry node).
const outcomeBoard = withPipelineRank([
  { name: "Applied", sortOrder: 0, kind: "active" },
  { name: "Rejected at screening", sortOrder: 1, kind: "rejected" },
  { name: "Screening", sortOrder: 2, kind: "active" },
  { name: "Ghosting", sortOrder: 3, kind: "closed" }
]);
const outcomeLanes = buildSankeyPayload({
  stages: outcomeBoard,
  transitions: [
    { fromStatus: "Applied", toStatus: "Screening", company: "F" },
    { fromStatus: "Screening", toStatus: "Rejected at screening", company: "F" },
    { fromStatus: "Applied", toStatus: "Rejected at screening", company: "G" },
    { fromStatus: "Applied", toStatus: "Ghosting", company: "H" }
  ],
  entries: [
    { entryStage: "Applied", company: "F" },
    { entryStage: "Applied", company: "G" },
    { entryStage: "Applied", company: "H" }
  ],
  current: [
    { stageName: "Rejected at screening", company: "F" },
    { stageName: "Rejected at screening", company: "G" },
    { stageName: "Ghosting", company: "H" }
  ]
});

assertAcyclic(outcomeLanes, "outcome lanes");
assert.equal(outcomeLanes.hiddenBackward, 0, "links into an earlier-positioned outcome lane are kept");
assert.deepEqual(
  outcomeLanes.nodes.map((node) => `${node.name}:${node.kind ?? "-"}`),
  ["New:-", "Applied:active", "Screening:active", "Rejected at screening:rejected", "Ghosting:closed"]
);

// Nodes are keyed by lane id. A lane deleted and re-created under the same
// name gets its own node, labelled "(deleted)", and does not collect the new
// lane's flows; a rename shows the current name.
const recreated = buildSankeyPayload({
  stages: [
    { id: 1, name: "Applied", sortOrder: 0, kind: "active" },
    { id: 7, name: "Screening", sortOrder: 1, kind: "active" },
    { id: 3, name: "Phone call", sortOrder: 2, kind: "active" }
  ],
  transitions: [
    { fromStatus: "Applied", fromStageId: 1, toStatus: "Screening", toStageId: null, company: "Old" },
    { fromStatus: "Applied", fromStageId: 1, toStatus: "Screening", toStageId: 7, company: "New" },
    { fromStatus: "Applied", fromStageId: 1, toStatus: "Call", toStageId: 3, company: "Renamed" }
  ],
  entries: [
    { entryStage: "Applied", entryStageId: 1, company: "Old" },
    { entryStage: "Applied", entryStageId: 1, company: "New" },
    { entryStage: "Applied", entryStageId: 1, company: "Renamed" }
  ],
  current: [
    { stageName: "Applied", stageId: 1, company: "Old" },
    { stageName: "Screening", stageId: 7, company: "New" },
    { stageName: "Phone call", stageId: 3, company: "Renamed" }
  ]
});

assertAcyclic(recreated, "re-created lane");
assert.deepEqual(
  recreated.nodes.map((node) => `${node.name}:${node.companies.join("+")}`),
  ["New:Old+New+Renamed", "Applied:Old+New+Renamed", "Screening:New", "Phone call:Renamed", "Screening (deleted):Old"]
);

// A deleted lane sits before the live lane it flowed into, so a card that went
// Applied -> Screening (deleted) -> Screening keeps every link.
const throughDeleted = buildSankeyPayload({
  stages: [
    { id: 1, name: "Applied", sortOrder: 0, kind: "active" },
    { id: 7, name: "Screening", sortOrder: 1, kind: "active" },
    { id: 4, name: "Interview", sortOrder: 2, kind: "interview" }
  ],
  transitions: [
    { fromStatus: "Applied", fromStageId: 1, toStatus: "Screening", toStageId: null, company: "A" },
    { fromStatus: "Screening", fromStageId: null, toStatus: "Screening", toStageId: 7, company: "A" }
  ],
  entries: [{ entryStage: "Applied", entryStageId: 1, company: "A" }],
  current: [{ stageName: "Screening", stageId: 7, company: "A" }]
});

assertAcyclic(throughDeleted, "through a deleted lane");
assert.equal(throughDeleted.hiddenBackward, 0, "no link out of the deleted lane is hidden");
assert.deepEqual(
  throughDeleted.nodes.map((node) => node.name),
  ["New", "Applied", "Screening (deleted)", "Screening", "Interview"]
);

console.log("Sankey DAG checks passed.");
