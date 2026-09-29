import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFunnel } from "../src/lib/funnel.ts";

const BOARD = [
  { id: 1, name: "Applied", sortOrder: 0, kind: "active" },
  { id: 2, name: "Rejected early", sortOrder: 1, kind: "rejected" },
  { id: 3, name: "Screening", sortOrder: 2, kind: "active" },
  { id: 4, name: "Interview", sortOrder: 3, kind: "interview" },
  { id: 5, name: "Offer", sortOrder: 4, kind: "offer" }
];

// Each card's visited lanes, by lane id.
const visits = (paths) =>
  Object.entries(paths).flatMap(([applicationId, stageIds]) =>
    stageIds.map((stageId) => ({ applicationId: Number(applicationId), stageId }))
  );

const shares = (funnel) => Object.fromEntries(funnel.map((row) => [row.stage, row.advanced]));

test("lanes come in pipeline rank, an outcome lane placed early last, with counts per lane", () => {
  const funnel = buildFunnel(BOARD, visits({ 1: [1, 3], 2: [1, 2], 3: [1] }));
  assert.deepEqual(funnel.map((row) => row.stage), ["Applied", "Screening", "Interview", "Offer", "Rejected early"]);
  assert.deepEqual(funnel.map((row) => row.reached), [3, 1, 0, 0, 1]);
});

test("the share counts the cards of this lane that reached a later pipeline lane", () => {
  // 1 and 2 went on from Applied; 3 stopped; 4 was added straight into Interview.
  const funnel = buildFunnel(BOARD, visits({ 1: [1, 3, 4], 2: [1, 3], 3: [1], 4: [4] }));
  assert.deepEqual(shares(funnel), { Applied: 66.7, Screening: 50, Interview: 0, Offer: null, "Rejected early": null });
});

test("a card added mid-pipeline does not inflate the share of the lanes before it", () => {
  // The lane totals would say 2 of 1 went on; per card, nobody from Applied did.
  const funnel = buildFunnel(BOARD, visits({ 1: [1], 2: [3], 3: [3] }));
  assert.equal(shares(funnel).Applied, 0);
});

test("a skipped lane still counts as going further", () => {
  const funnel = buildFunnel(BOARD, visits({ 1: [1, 4] }));
  assert.equal(shares(funnel).Applied, 100);
  assert.equal(shares(funnel).Screening, null, "nobody reached Screening");
});

test("moving into an outcome lane is not going further", () => {
  const funnel = buildFunnel(BOARD, visits({ 1: [1, 2] }));
  assert.equal(shares(funnel).Applied, 0);
});

test("no share for outcome lanes, the last pipeline lane, or an empty board", () => {
  const funnel = buildFunnel(BOARD, visits({ 1: [1, 3, 4, 5], 2: [2] }));
  assert.equal(shares(funnel).Offer, null);
  assert.equal(shares(funnel)["Rejected early"], null);
  assert.deepEqual(buildFunnel([], []), []);
});

test("shares round to one decimal", () => {
  const funnel = buildFunnel(BOARD, visits({ 1: [1, 3], 2: [1, 3], 3: [1] }));
  assert.equal(shares(funnel).Applied, 66.7);
});
