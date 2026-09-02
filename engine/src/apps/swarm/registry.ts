// engine/src/apps/swarm/registry.ts -- SUB-3, a full TypeScript port of
// backend/apps/swarm/registry.py.
//
// Maps an EntityType to the Exportable that handles it, and the leaves-first order import walks.
// Adding a shareable type is one entry here plus its module -- identical shape to the Python
// original.

import { SkillExportable } from '../skills/swarmSkillEntity';
import { AppExportable } from './entities/appExportable';
import { DashboardExportable } from './entities/dashboardExportable';
import { ModeExportable } from './entities/modeExportable';
import { SessionExportable } from './entities/sessionExportable';
import { WorkflowExportable } from './entities/workflowExportable';
import type { ExportableClass } from './exportable';
import { EntityType } from './models';

export const REGISTRY: Readonly<Record<EntityType, ExportableClass>> = {
  [EntityType.skill]: SkillExportable,
  [EntityType.app]: AppExportable,
  [EntityType.workflow]: WorkflowExportable,
  [EntityType.mode]: ModeExportable,
  [EntityType.session]: SessionExportable,
  [EntityType.dashboard]: DashboardExportable,
};

// Leaves first: a dependency must import before whatever references it.
export const IMPORT_ORDER: readonly EntityType[] = [
  EntityType.skill,
  EntityType.mode,
  EntityType.session,
  EntityType.app,
  EntityType.workflow,
  EntityType.dashboard,
];

export function getExportable(etype: EntityType): ExportableClass | null {
  return REGISTRY[etype] ?? null;
}
