import assert from "node:assert/strict";
import { test } from "node:test";
import { isLaneHidden, matchesBoardFilter } from "../src/lib/board-filter.ts";
import { STAGE_KINDS } from "../src/lib/stage-kinds.ts";

const card = { company: "Northwind Traders", role: "Data Engineer" };

test("the filter matches company or role, ignoring case and surrounding spaces", () => {
  assert.equal(matchesBoardFilter(card, "northwind"), true);
  assert.equal(matchesBoardFilter(card, "  DATA eng "), true);
  assert.equal(matchesBoardFilter(card, "traders data"), false, "not across the two fields");
  assert.equal(matchesBoardFilter(card, "analyst"), false);
});

test("an empty filter matches every card", () => {
  assert.equal(matchesBoardFilter(card, ""), true);
  assert.equal(matchesBoardFilter(card, "   "), true);
});

test("a card is not matched by its notes (a guard against adding them)", () => {
  assert.equal(matchesBoardFilter({ ...card, notes: "referral from a friend" }, "referral"), false);
});

test("hiding outcome lanes hides rejected and closed lanes, and nothing else", () => {
  const hidden = STAGE_KINDS.filter((kind) => isLaneHidden(kind, true));
  assert.deepEqual(hidden.sort(), ["closed", "rejected"]);
  assert.deepEqual(STAGE_KINDS.filter((kind) => isLaneHidden(kind, false)), []);
});
