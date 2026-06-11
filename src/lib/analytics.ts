import { track } from "@vercel/analytics";

export function trackLogin(success: boolean) {
  track(success ? "login_success" : "login_failure");
}

export function trackLogout() {
  track("logout");
}

export function trackApplicationCreated(props: {
  stageName: string;
  hasSourceUrl: boolean;
  hasInterviewDate: boolean;
  hasNotes: boolean;
}) {
  track("application_created", props);
}

export function trackApplicationUpdated(props: {
  stageChanged: boolean;
  stageName: string;
  hasInterviewDate: boolean;
}) {
  track("application_updated", props);
}

export function trackApplicationMoved(props: { fromStageName: string; toStageName: string }) {
  track("application_moved", props);
}

export function trackApplicationDeleted() {
  track("application_deleted");
}

export function trackStageAdded(props: { stageName: string }) {
  track("stage_added", props);
}

export function trackStageDeleted() {
  track("stage_deleted");
}

export function trackStageReordered() {
  track("stage_reordered");
}
