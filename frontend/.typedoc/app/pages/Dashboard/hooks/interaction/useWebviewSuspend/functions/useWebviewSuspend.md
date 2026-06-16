[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/interaction/useWebviewSuspend](../README.md) / useWebviewSuspend

# Function: useWebviewSuspend()

> **useWebviewSuspend**(`browserCards`, `panX`, `panY`, `zoom`, `viewportRef`): `void`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/interaction/useWebviewSuspend.ts:66](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/interaction/useWebviewSuspend.ts#L66)

Swaps off-screen, agent-idle webviews for static snapshots (freeing their
renderer processes) and wakes them when panned back into view. Agent-driven
cards are never touched; commands to a suspended card wake it via
browserCommandHandler's awaitWebview.

## Parameters

### browserCards

`Record`\<`string`, [`BrowserCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/BrowserCardPosition.md)\>

### panX

`number`

### panY

`number`

### zoom

`number`

### viewportRef

`RefObject`\<`HTMLDivElement`\>

## Returns

`void`
