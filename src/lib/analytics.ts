import { track } from "@vercel/analytics";
import type { StageKind } from "@/lib/stage-kinds";

// Events carry lane kinds, never lane names: a name is free text the owner
// typed (it can name a company or a person) and would leave the app with
// every event.

export function trackLogin(success: boolean) {
  track(success ? "login_success" : "login_failure");
}

export function trackLogout() {
  track("logout");
}

export function trackApplicationCreated(props: {
  stageKind: StageKind;
  hasSourceUrl: boolean;
  hasInterviewDate: boolean;
  hasNotes: boolean;
}) {
  track("application_created", props);
}

export function trackApplicationUpdated(props: {
  stageChanged: boolean;
  stageKind: StageKind;
  hasInterviewDate: boolean;
}) {
  track("application_updated", props);
}

export function trackApplicationMoved(props: { fromStageKind: StageKind; toStageKind: StageKind }) {
  track("application_moved", props);
}

export function trackApplicationDeleted() {
  track("application_deleted");
}

export function trackStageAdded(props: { stageKind: StageKind }) {
  track("stage_added", props);
}

export function trackStageDeleted() {
  track("stage_deleted");
}

export function trackStageReordered() {
  track("stage_reordered");
}

export function trackStaleAction(props: { action: "followed_up" | "snooze" | "close" }) {
  track("stale_action", props);
}

export function trackGhostedClosed(props: { count: number; days: number }) {
  track("ghosted_closed", props);
}
