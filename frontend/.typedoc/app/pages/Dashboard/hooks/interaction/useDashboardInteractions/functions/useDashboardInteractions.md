[**open-swarm**](../../../../../../../README.md)

***

[open-swarm](../../../../../../../README.md) / [app/pages/Dashboard/hooks/interaction/useDashboardInteractions](../README.md) / useDashboardInteractions

# Function: useDashboardInteractions()

> **useDashboardInteractions**(`__namedParameters`): `object`

Defined in: [Desktop/openswarm-ai/all-things-analytics/openswarm/frontend/src/app/pages/Dashboard/hooks/interaction/useDashboardInteractions.ts:32](https://github.com/openswarm-ai/openswarm/blob/019a71c26d428a6c93dd027186193f1e068bd25e/frontend/src/app/pages/Dashboard/hooks/interaction/useDashboardInteractions.ts#L32)

## Parameters

### \_\_namedParameters

`UseDashboardInteractionsArgs`

## Returns

`object`

### handleBringToFront

> **handleBringToFront**: (`id`, `type`) => `void`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

#### Returns

`void`

### handleCardDoubleClick

> **handleCardDoubleClick**: (`id`, `type`) => `void`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

#### Returns

`void`

### handleCardSelect

> **handleCardSelect**: (`id`, `type`, `shiftKey`) => `void`

#### Parameters

##### id

`string`

##### type

[`CardType`](../../../../../../../shared/state/dashboardLayoutSlice/type-aliases/CardType.md)

##### shiftKey

`boolean`

#### Returns

`void`

### handleViewportDoubleClick

> **handleViewportDoubleClick**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### handleViewportMouseDown

> **handleViewportMouseDown**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### handleViewportMouseMove

> **handleViewportMouseMove**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`

### handleViewportMouseUp

> **handleViewportMouseUp**: (`e`) => `void`

#### Parameters

##### e

`MouseEvent`

#### Returns

`void`
