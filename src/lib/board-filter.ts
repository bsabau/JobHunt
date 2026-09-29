// The board filter's rules, loadable straight from Node for the tests
// (tests/board-filter.test.mjs).

import { isTerminalKind, type StageKind } from "./stage-kinds.ts";

// Case-insensitive substring over company and role, the text on the card.
// Never notes: a guest has none, and the owner could not see why a card matched.
export function matchesBoardFilter(app: { company: string; role: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return app.company.toLowerCase().includes(needle) || app.role.toLowerCase().includes(needle);
}

// "Hide outcome lanes" hides rejected and closed lanes, chosen by kind. Offer
// lanes stay: an offer is still in play.
export function isLaneHidden(kind: StageKind, hideOutcomeLanes: boolean): boolean {
  return hideOutcomeLanes && isTerminalKind(kind);
}
