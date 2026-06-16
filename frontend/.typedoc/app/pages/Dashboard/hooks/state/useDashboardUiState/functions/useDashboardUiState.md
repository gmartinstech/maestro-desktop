[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/state/useDashboardUiState](../README.md) / useDashboardUiState

# Function: useDashboardUiState()

> **useDashboardUiState**(`selection`, `cards`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/state/useDashboardUiState.ts:12](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/state/useDashboardUiState.ts#L12)

## Parameters

### selection

#### deselectAll

() => `void`

#### handleCanvasMouseDown

(`e`) => `void`

#### handleCanvasMouseMove

(`e`) => `void`

#### handleCanvasMouseUp

(`e`) => `void`

#### isSelected

(`id`) => `boolean`

#### marquee

[`MarqueeRect`](../../useDashboardSelection/interfaces/MarqueeRect.md) \| `null`

#### selectAll

() => `void`

#### selectCard

(`id`, `type`, `shiftKey`) => `void`

#### selectedArray

() => [`SelectedCard`](../../useDashboardSelection/interfaces/SelectedCard.md)[]

#### selectedIds

`Map`\<`string`, [`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)\>

### cards

`Record`\<`string`, [`CardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/CardPosition.md)\>

## Returns

`object`

### autoFocusSessionId

> **autoFocusSessionId**: `string` \| `null`

### focusedCardId

> **focusedCardId**: `string` \| `null`

### handleHighlightCard

> **handleHighlightCard**: (`cardId`) => `void`

#### Parameters

##### cardId

`string`

#### Returns

`void`

### handleMeasuredHeight

> **handleMeasuredHeight**: (`sessionId`, `height`) => `void`

#### Parameters

##### sessionId

`string`

##### height

`number`

#### Returns

`void`

### hasFittedRef

> **hasFittedRef**: `MutableRefObject`\<`boolean`\>

### highlightedCardId

> **highlightedCardId**: `string` \| `null`

### measuredHeightsRef

> **measuredHeightsRef**: `MutableRefObject`\<`Record`\<`string`, `number`\>\>

### measuredHeightsTick

> **measuredHeightsTick**: `number`

### newAgentBounce

> **newAgentBounce**: `boolean`

### restoredExpandedRef

> **restoredExpandedRef**: `MutableRefObject`\<`boolean`\>

### revealSpawnedRef

> **revealSpawnedRef**: `MutableRefObject`\<`Set`\<`string`\>\>

### searchPaletteOpen

> **searchPaletteOpen**: `boolean`

### setAutoFocusSessionId

> **setAutoFocusSessionId**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setFocusedCardId

> **setFocusedCardId**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setNewAgentBounce

> **setNewAgentBounce**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setPendingSelectSessionId

> **setPendingSelectSessionId**: `Dispatch`\<`SetStateAction`\<`string` \| `null`\>\>

### setSearchPaletteOpen

> **setSearchPaletteOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### setToolbarOpen

> **setToolbarOpen**: `Dispatch`\<`SetStateAction`\<`boolean`\>\>

### spawnOriginsRef

> **spawnOriginsRef**: `MutableRefObject`\<`Record`\<`string`, `SpawnOrigin`\>\>

### toolbarOpen

> **toolbarOpen**: `boolean`

### toolbarRef

> **toolbarRef**: `RefObject`\<`HTMLDivElement`\>
