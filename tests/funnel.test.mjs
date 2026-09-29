import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFunnel } from "../src/lib/funnel.ts";

const lane = (stage, sortOrder, kind, reached) => ({ stage, sortOrder, kind, reached });

test("an outcome lane placed early on the board ranks after the pipeline, with no rate", () => {
  const funnel = buildFunnel([
    lane("Applied", 0, "active", 10),
    lane("Rejected early", 1, "rejected", 6),
    lane("Screening", 2, "active", 4),
    lane("Interview", 3, "interview", 2)
  ]);
  assert.deepEqual(funnel.map((row) => row.stage), ["Applied", "Screening", "Interview", "Rejected early"]);
  assert.deepEqual(funnel.map((row) => row.advanced), [40, 50, null, null]);
});

test("no rate into or out of an outcome lane, and none from the last pipeline lane", () => {
  const funnel = buildFunnel([lane("Applied", 0, "active", 5), lane("Ghosted", 1, "closed", 5)]);
  assert.deepEqual(funnel.map((row) => row.advanced), [null, null]);
});

test("no rate when the next lane was reached by more applications than this one", () => {
  const funnel = buildFunnel([lane("Applied", 0, "active", 2), lane("Interview", 1, "interview", 3), lane("Offer", 2, "offer", 1)]);
  assert.deepEqual(funnel.map((row) => row.advanced), [null, 33.3, null]);
});

test("a lane nobody reached has no rate, and nothing divides by zero", () => {
  const funnel = buildFunnel([lane("Wishlist", 0, "intake", 0), lane("Applied", 1, "active", 0)]);
  assert.deepEqual(funnel.map((row) => row.advanced), [null, null]);
  assert.deepEqual(buildFunnel([]), []);
});

test("rates round to one decimal", () => {
  const funnel = buildFunnel([lane("Applied", 0, "active", 3), lane("Screening", 1, "active", 2)]);
  assert.equal(funnel[0].advanced, 66.7);
});
