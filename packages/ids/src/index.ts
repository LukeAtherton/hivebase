// Time-ordered ULIDs for every cockpit entity. Prefixed so they're
// distinguishable in logs and debug output.
import { ulid } from 'ulid';

export function generateCockpitProjectId(): string {
  return `ckpr_${ulid()}`;
}

export function generateCockpitWorkspaceId(): string {
  return `ckws_${ulid()}`;
}

export function generateCockpitAgentId(): string {
  return `ckag_${ulid()}`;
}

export function generateCockpitSessionId(): string {
  return `ckse_${ulid()}`;
}

export function generateCockpitDecisionId(): string {
  return `ckde_${ulid()}`;
}

export function generateCockpitLedgerId(): string {
  return `ckle_${ulid()}`;
}

export function generateCockpitEventId(): string {
  return `ckev_${ulid()}`;
}
