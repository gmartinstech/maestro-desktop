// Shared visual helpers for the workflow card UI tier: schedule/permission pill chips, status dot, run-status sparkline, step connector, step icon auto-classifier. Kept as plain functions/components so individual views can compose without owning the styling.
//
// Split across sibling modules to stay under the file-length cap: workflowVisualsStatus (title
// placeholders, status colors, sparkline, streak badge), workflowVisualsChips (pill chips, cost
// chip), workflowVisualsSteps (step icon classifier, duration learner, run-button breath logic).
// Re-exported here so `./workflowVisuals` stays the single import surface for consumers.

export {
  isRealTitle,
  statusDotColor,
  statusWord,
  StatusDot,
  RunSparkline,
  successStreak,
  StreakBadge,
} from './workflowVisualsStatus';
export type { LastRunStatus } from './workflowVisualsStatus';

export {
  WeekdayDots,
  PermissionChip,
  ScheduleChip,
  routingFor,
  CostChip,
  LastFiredHint,
} from './workflowVisualsChips';
export type { RoutingKind, Routing } from './workflowVisualsChips';

export {
  stepIconFor,
  estimateStepDuration,
  humanDuration,
  isStaleSinceLastRun,
} from './workflowVisualsSteps';
