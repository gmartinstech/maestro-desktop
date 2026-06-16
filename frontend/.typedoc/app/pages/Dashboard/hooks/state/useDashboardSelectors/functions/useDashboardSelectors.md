[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/state/useDashboardSelectors](../README.md) / useDashboardSelectors

# Function: useDashboardSelectors()

> **useDashboardSelectors**(`dashboardId`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/state/useDashboardSelectors.ts:6](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/state/useDashboardSelectors.ts#L6)

## Parameters

### dashboardId

`string`

## Returns

`object`

### autoRevealSubAgents

> **autoRevealSubAgents**: `boolean`

### browserCards

> **browserCards**: `Record`\<`string`, [`BrowserCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/BrowserCardPosition.md)\>

### browserHomepage

> **browserHomepage**: `string`

### cards

> **cards**: `Record`\<`string`, [`CardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/CardPosition.md)\>

### dashboardName

> **dashboardName**: `string` \| `undefined`

### expandedSessionIds

> **expandedSessionIds**: `string`[]

### expandNewChats

> **expandNewChats**: `boolean`

### glowingAgentCards

> **glowingAgentCards**: `Record`\<`string`, \{ `fading`: `boolean`; `label?`: `string`; `sourceId`: `string`; `sourceYRatio?`: `number`; \}\>

### glowingBrowserCards

> **glowingBrowserCards**: `Record`\<`string`, \{ `fading`: `boolean`; `label?`: `string`; `sourceId`: `string`; \}\>

### layoutInitialized

> **layoutInitialized**: `boolean`

### newAgentShortcut

> **newAgentShortcut**: `string`

### notes

> **notes**: `Record`\<`string`, [`NotePosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/NotePosition.md)\>

### outputs

> **outputs**: `Record`\<`string`, [`Output`](../../../../../../../shared/state/outputsSlice/interfaces/Output.md)\>

### outputsLoaded

> **outputsLoaded**: `boolean`

### pendingFocusNoteId

> **pendingFocusNoteId**: `string` \| `null`

### persistedExpandedSessionIds

> **persistedExpandedSessionIds**: `string`[]

### sessions

> **sessions**: `Record`\<`string`, [`AgentSession`](../../../../../../../shared/state/agentsSlice/interfaces/AgentSession.md)\>

### viewCards

> **viewCards**: `Record`\<`string`, [`ViewCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/ViewCardPosition.md)\>

### zoomSensitivity

> **zoomSensitivity**: `number`
