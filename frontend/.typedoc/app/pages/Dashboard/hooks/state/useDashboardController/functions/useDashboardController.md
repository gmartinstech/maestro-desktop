[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/state/useDashboardController](../README.md) / useDashboardController

# Function: useDashboardController()

> **useDashboardController**(`dashboardId`, `isActive`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts:27](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/state/useDashboardController.ts#L27)

## Parameters

### dashboardId

`string`

### isActive

`boolean`

## Returns

`object`

### autoFocusSessionId

> **autoFocusSessionId**: `string` \| `null`

### browserCards

> **browserCards**: `Record`\<`string`, [`BrowserCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/BrowserCardPosition.md)\>

### c

> **c**: [`ClaudeTokens`](../../../../../../../shared/styles/claudeTokens/interfaces/ClaudeTokens.md)

### canvas

> **canvas**: `object`

#### canvas.actions

> **actions**: `object`

#### canvas.actions.animateTo

> **animateTo**: (`target`, `duration`) => `void`

##### Parameters

###### target

`CanvasState`

###### duration?

`number` = `320`

##### Returns

`void`

#### canvas.actions.cancelAnimation

> **cancelAnimation**: () => `void`

##### Returns

`void`

#### canvas.actions.fitToCards

> **fitToCards**: (`cardRects`, `maxZoom?`, `animate?`, `minZoom?`) => `void`

##### Parameters

###### cardRects

`object`[]

###### maxZoom?

`number`

###### animate?

`boolean`

###### minZoom?

`number`

##### Returns

`void`

#### canvas.actions.fitToView

> **fitToView**: () => `void`

##### Returns

`void`

#### canvas.actions.resetZoom

> **resetZoom**: () => `void`

##### Returns

`void`

#### canvas.actions.setState

> **setState**: `Dispatch`\<`SetStateAction`\<`CanvasState`\>\>

#### canvas.actions.zoomIn

> **zoomIn**: () => `void`

##### Returns

`void`

#### canvas.actions.zoomOut

> **zoomOut**: () => `void`

##### Returns

`void`

#### canvas.cmdHeld

> **cmdHeld**: `boolean`

#### canvas.contentRef

> **contentRef**: `RefObject`\<`HTMLDivElement`\>

#### canvas.handlers

> **handlers**: `object`

#### canvas.handlers.onMouseDown

> **onMouseDown**: (`e`) => `void` = `handleMouseDown`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### canvas.handlers.onMouseMove

> **onMouseMove**: (`e`) => `void` = `handleMouseMove`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### canvas.handlers.onMouseUp

> **onMouseUp**: () => `void` = `handleMouseUp`

##### Returns

`void`

#### canvas.isPanning

> **isPanning**: `boolean`

#### canvas.panX

> `readonly` **panX**: `number`

#### canvas.panY

> `readonly` **panY**: `number`

#### canvas.spaceHeld

> **spaceHeld**: `boolean`

#### canvas.viewportRef

> **viewportRef**: `RefObject`\<`HTMLDivElement`\>

#### canvas.zoom

> `readonly` **zoom**: `number`

### cards

> **cards**: `Record`\<`string`, [`CardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/CardPosition.md)\>

### dashboardId

> **dashboardId**: `string`

### dashboardName

> **dashboardName**: `string` \| `undefined`

### expandedSessionIds

> **expandedSessionIds**: `string`[]

### focusedCardId

> **focusedCardId**: `string` \| `null`

### getCanvasState

> **getCanvasState**: () => `object`

#### Returns

`object`

##### panX

> **panX**: `number` = `canvas.panX`

##### panY

> **panY**: `number` = `canvas.panY`

##### zoom

> **zoom**: `number` = `canvas.zoom`

### glowingAgentCards

> **glowingAgentCards**: `Record`\<`string`, \{ `fading`: `boolean`; `label?`: `string`; `sourceId`: `string`; `sourceYRatio?`: `number`; \}\>

### highlightedCardId

> **highlightedCardId**: `string` \| `null`

### measuredHeightsRef

> **measuredHeightsRef**: `MutableRefObject`\<`Record`\<`string`, `number`\>\>

### multiDragDelta

> **multiDragDelta**: \{ `dx`: `number`; `dy`: `number`; \} \| `null`

### neighborDirections

> **neighborDirections**: `object`

#### neighborDirections.down

> **down**: `boolean` = `false`

#### neighborDirections.left

> **left**: `boolean` = `false`

#### neighborDirections.right

> **right**: `boolean` = `false`

#### neighborDirections.up

> **up**: `boolean` = `false`

### newAgentBounce

> **newAgentBounce**: `boolean`

### notes

> **notes**: `Record`\<`string`, [`NotePosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/NotePosition.md)\>

### onAddBrowser

> **onAddBrowser**: () => `void` = `handleAddBrowser`

#### Returns

`void`

### onAddNote

> **onAddNote**: () => `void` = `handleAddNote`

#### Returns

`void`

### onAddView

> **onAddView**: (`outputId`) => `void` = `handleAddView`

#### Parameters

##### outputId

`string`

#### Returns

`void`

### onBranch

> **onBranch**: (`sourceSessionId`, `newSessionId`) => `void` = `handleBranchFromCard`

#### Parameters

##### sourceSessionId

`string`

##### newSessionId

`string`

#### Returns

`void`

### onBringToFront

> **onBringToFront**: (`id`, `type`) => `void` = `handleBringToFront`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

#### Returns

`void`

### onCardDoubleClick

> **onCardDoubleClick**: (`id`, `type`) => `void` = `handleCardDoubleClick`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

#### Returns

`void`

### onCardSelect

> **onCardSelect**: (`id`, `type`, `shiftKey`) => `void` = `handleCardSelect`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

##### shiftKey

`boolean`

#### Returns

`void`

### onDragEnd

> **onDragEnd**: (`dx`, `dy`, `didDrag`) => `void` = `handleCardDragEnd`

#### Parameters

##### dx

`number`

##### dy

`number`

##### didDrag

`boolean`

#### Returns

`void`

### onDragMove

> **onDragMove**: (`dx`, `dy`, `mouseX?`, `mouseY?`) => `void` = `handleCardDragMove`

#### Parameters

##### dx

`number`

##### dy

`number`

##### mouseX?

`number`

##### mouseY?

`number`

#### Returns

`void`

### onDragStart

> **onDragStart**: (`id`, `_type`) => `void` = `handleCardDragStart`

#### Parameters

##### id

`string`

##### \_type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

#### Returns

`void`

### onFitToView

> **onFitToView**: () => `void` = `handleFitToView`

#### Returns

`void`

### onHighlightCard

> **onHighlightCard**: (`cardId`) => `void` = `handleHighlightCard`

#### Parameters

##### cardId

`string`

#### Returns

`void`

### onHistoryResume

> **onHistoryResume**: (`sessionId`) => `void` = `handleHistoryResume`

#### Parameters

##### sessionId

`string`

#### Returns

`void`

### onMeasuredHeight

> **onMeasuredHeight**: (`sessionId`, `height`) => `void` = `handleMeasuredHeight`

#### Parameters

##### sessionId

`string`

##### height

`number`

#### Returns

`void`

### onNewAgent

> **onNewAgent**: () => `void` = `handleNewAgent`

#### Returns

`void`

### onNewAgentBounceEnd

> **onNewAgentBounceEnd**: () => `void`

#### Returns

`void`

### onSearchPaletteClose

> **onSearchPaletteClose**: () => `void`

#### Returns

`void`

### onStarter

> **onStarter**: (`prompt`, `mode?`) => `void` = `handleStarter`

#### Parameters

##### prompt

`string`

##### mode?

`string`

#### Returns

`void`

### onTidy

> **onTidy**: () => `void` = `handleTidy`

#### Returns

`void`

### onToolbarCancel

> **onToolbarCancel**: () => `void` = `handleToolbarCancel`

#### Returns

`void`

### onToolbarSend

> **onToolbarSend**: (`prompt`, `mode`, `model`, `images?`, `contextPaths?`, `forcedTools?`, `attachedSkills?`, `selectedBrowserIds?`) => `void` = `handleToolbarSend`

#### Parameters

##### prompt

`string`

##### mode

`string`

##### model

`string`

##### images?

`object`[]

##### contextPaths?

[`ContextPath`](../../../../../../components/editor/DirectoryBrowser/interfaces/ContextPath.md)[]

##### forcedTools?

`string`[]

##### attachedSkills?

`object`[]

##### selectedBrowserIds?

`string`[]

#### Returns

`void`

### onViewportDoubleClick

> **onViewportDoubleClick**: (`e`) => `void` = `handleViewportDoubleClick`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### onViewportMouseDown

> **onViewportMouseDown**: (`e`) => `void` = `handleViewportMouseDown`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### onViewportMouseMove

> **onViewportMouseMove**: (`e`) => `void` = `handleViewportMouseMove`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### onViewportMouseUp

> **onViewportMouseUp**: (`e`) => `void` = `handleViewportMouseUp`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### outputs

> **outputs**: `Record`\<`string`, [`Output`](../../../../../../../shared/state/outputsSlice/interfaces/Output.md)\>

### pendingFocusNoteId

> **pendingFocusNoteId**: `string` \| `null`

### revealSpawnedRef

> **revealSpawnedRef**: `MutableRefObject`\<`Set`\<`string`\>\>

### searchPaletteOpen

> **searchPaletteOpen**: `boolean`

### selection

> **selection**: `object`

#### selection.deselectAll

> **deselectAll**: () => `void`

##### Returns

`void`

#### selection.handleCanvasMouseDown

> **handleCanvasMouseDown**: (`e`) => `void`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### selection.handleCanvasMouseMove

> **handleCanvasMouseMove**: (`e`) => `void`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### selection.handleCanvasMouseUp

> **handleCanvasMouseUp**: (`e`) => `void`

##### Parameters

###### e

`MouseEvent`

##### Returns

`void`

#### selection.isSelected

> **isSelected**: (`id`) => `boolean`

##### Parameters

###### id

`string`

##### Returns

`boolean`

#### selection.marquee

> **marquee**: [`MarqueeRect`](../../useDashboardSelection/interfaces/MarqueeRect.md) \| `null`

#### selection.selectAll

> **selectAll**: () => `void`

##### Returns

`void`

#### selection.selectCard

> **selectCard**: (`id`, `type`, `shiftKey`) => `void`

##### Parameters

###### id

`string`

###### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

###### shiftKey

`boolean`

##### Returns

`void`

#### selection.selectedArray

> **selectedArray**: () => [`SelectedCard`](../../useDashboardSelection/interfaces/SelectedCard.md)[]

##### Returns

[`SelectedCard`](../../useDashboardSelection/interfaces/SelectedCard.md)[]

#### selection.selectedIds

> **selectedIds**: `Map`\<`string`, [`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)\>

### sessionList

> **sessionList**: [`AgentSession`](../../../../../../../shared/state/agentsSlice/interfaces/AgentSession.md)[]

### sessions

> **sessions**: `Record`\<`string`, [`AgentSession`](../../../../../../../shared/state/agentsSlice/interfaces/AgentSession.md)\>

### shakeDirection

> **shakeDirection**: `Direction` \| `null`

### spawnOriginsRef

> **spawnOriginsRef**: `MutableRefObject`\<`Record`\<`string`, `SpawnOrigin`\>\>

### tethers

> **tethers**: [`Tether`](../../../../geometry/dashboardTethers/interfaces/Tether.md)[]

### toolbarOpen

> **toolbarOpen**: `boolean`

### toolbarPrefill

> **toolbarPrefill**: `string` \| `undefined`

### toolbarPrefillMode

> **toolbarPrefillMode**: `string` \| `undefined`

### toolbarRef

> **toolbarRef**: `RefObject`\<`HTMLDivElement`\>

### viewCards

> **viewCards**: `Record`\<`string`, [`ViewCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/ViewCardPosition.md)\>
