// Run-state views for the workflow card. The card's `view` field flips to 'running' / 'completed' / 'failed' off of the workflow:run ws stream (see upsertRun reducer). Each view here renders the same step list with a different status overlay + a different footer.
//
// Split across sibling modules to stay under the file-length cap: WorkflowCardLiveViewsShared
// (sidecar plumbing + shared pill/progress bits), RunningView, CompletedView, FailedView, and
// WorkflowCardHeaderActions. Re-exported here so `./WorkflowCardLiveViews` stays the single
// import surface for consumers.

export { useOpenSidecar } from './WorkflowCardLiveViewsShared';
export { RunningView } from './RunningView';
export { CompletedView } from './CompletedView';
export { FailedView } from './FailedView';
export { useHeaderActions } from './WorkflowCardHeaderActions';
export type { HeaderActions } from './WorkflowCardHeaderActions';
