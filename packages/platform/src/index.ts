export { getCockpitDb, closeCockpitDb, schema } from './client';
export type { CockpitDb } from './client';

export {
  cockpitProjects,
  cockpitWorkspaces,
  cockpitAgents,
  cockpitSessions,
  cockpitEvents,
  cockpitDecisions,
  cockpitDecisionLedger,
} from './schema/index';
