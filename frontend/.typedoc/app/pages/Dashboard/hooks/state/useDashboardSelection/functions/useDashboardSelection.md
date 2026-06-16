[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/state/useDashboardSelection](../README.md) / useDashboardSelection

# Function: useDashboardSelection()

> **useDashboardSelection**(`canvas`, `cards`, `viewCards`, `browserCards?`, `notes?`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/state/useDashboardSelection.ts:40](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/state/useDashboardSelection.ts#L40)

## Parameters

### canvas

`ScreenToCanvas`

### cards

`Record`\<`string`, [`CardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/CardPosition.md)\>

### viewCards

`Record`\<`string`, [`ViewCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/ViewCardPosition.md)\>

### browserCards?

`Record`\<`string`, [`BrowserCardPosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/BrowserCardPosition.md)\> = `{}`

### notes?

`Record`\<`string`, [`NotePosition`](../../../../../../../shared/state/dashboardLayoutSlice/interfaces/NotePosition.md)\> = `{}`

## Returns

`object`

### deselectAll

> **deselectAll**: () => `void`

#### Returns

`void`

### handleCanvasMouseDown

> **handleCanvasMouseDown**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### handleCanvasMouseMove

> **handleCanvasMouseMove**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### handleCanvasMouseUp

> **handleCanvasMouseUp**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### isSelected

> **isSelected**: (`id`) => `boolean`

#### Parameters

##### id

`string`

#### Returns

`boolean`

### marquee

> **marquee**: [`MarqueeRect`](../interfaces/MarqueeRect.md) \| `null`

### selectAll

> **selectAll**: () => `void`

#### Returns

`void`

### selectCard

> **selectCard**: (`id`, `type`, `shiftKey`) => `void`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

##### shiftKey

`boolean`

#### Returns

`void`

### selectedArray

> **selectedArray**: () => [`SelectedCard`](../interfaces/SelectedCard.md)[]

#### Returns

[`SelectedCard`](../interfaces/SelectedCard.md)[]

### selectedIds

> **selectedIds**: `Map`\<`string`, [`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)\>
