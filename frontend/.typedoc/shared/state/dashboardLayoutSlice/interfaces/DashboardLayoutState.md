[**open-swarm**](../../../../README.md)

***

[open-swarm](../../../../README.md) / [shared/state/dashboardLayoutSlice](../README.md) / DashboardLayoutState

# Interface: DashboardLayoutState

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:82](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L82)

## Properties

### browserCards

> **browserCards**: `Record`\<`string`, [`BrowserCardPosition`](BrowserCardPosition.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:85](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L85)

***

### cards

> **cards**: `Record`\<`string`, [`CardPosition`](CardPosition.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:83](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L83)

***

### closedCardPositions

> **closedCardPositions**: `Record`\<`string`, [`CardPosition`](CardPosition.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:87](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L87)

***

### glowingAgentCards

> **glowingAgentCards**: `Record`\<`string`, \{ `fading`: `boolean`; `label?`: `string`; `sourceId`: `string`; `sourceYRatio?`: `number`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:89](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L89)

***

### glowingBrowserCards

> **glowingBrowserCards**: `Record`\<`string`, \{ `fading`: `boolean`; `label?`: `string`; `sourceId`: `string`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:88](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L88)

***

### initialized

> **initialized**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:93](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L93)

***

### loading

> **loading**: `boolean`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:92](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L92)

***

### nextZOrder

> **nextZOrder**: `number`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:91](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L91)

***

### notes

> **notes**: `Record`\<`string`, [`NotePosition`](NotePosition.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:86](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L86)

***

### pendingFocusBrowserId

> **pendingFocusBrowserId**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:95](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L95)

Transient: new browser card id; Dashboard pans/zooms to it then clears via clearPendingFocusBrowserId.

***

### pendingFocusNoteId

> **pendingFocusNoteId**: `string` \| `null`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:96](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L96)

***

### persistedExpandedSessionIds

> **persistedExpandedSessionIds**: `string`[]

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:90](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L90)

***

### suspendedBrowserCards

> **suspendedBrowserCards**: `Record`\<`string`, \{ `capturedAt`: `number`; `dataUrl`: `string`; \}\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:98](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L98)

Transient: snapshot stand-ins for off-screen webviews; never rides the layout PUT.

***

### viewCards

> **viewCards**: `Record`\<`string`, [`ViewCardPosition`](ViewCardPosition.md)\>

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/shared/state/dashboardLayoutSlice.ts:84](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/shared/state/dashboardLayoutSlice.ts#L84)
